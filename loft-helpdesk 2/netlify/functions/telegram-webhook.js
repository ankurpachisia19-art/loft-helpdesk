const TELEGRAM_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const EMAILJS_PK      = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_SVC     = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TPL     = 'loft_ticket_closed';
const PROJECT_ID      = 'loft-finance';

async function findTicketByTelegramMsgId(msgId) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'loft_tickets' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'telegramMessageId' },
              op: 'EQUAL',
              value: { integerValue: msgId }
            }
          },
          limit: 1
        }
      })
    }
  );
  const results = await res.json();
  return results[0]?.document || null;
}

async function closeTicket(ticketId) {
  const now = new Date().toISOString();
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/loft_tickets/${ticketId}?updateMask.fieldPaths=status&updateMask.fieldPaths=closedAt&updateMask.fieldPaths=updatedAt&key=${FIREBASE_API_KEY}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          status:    { stringValue: 'closed' },
          closedAt:  { timestampValue: now },
          updatedAt: { timestampValue: now }
        }
      })
    }
  );
}

async function sendEmail(ticket, ticketId) {
  if (!ticket.email || !EMAILJS_PK) return;
  try {
    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id:    EMAILJS_SVC,
        template_id:   EMAILJS_TPL,
        user_id:       EMAILJS_PK,
        template_params: {
          ticket_id:   ticketId.slice(0,8).toUpperCase(),
          member_name: ticket.memberName,
          category:    ticket.category,
          description: ticket.description,
          to_email:    ticket.email
        }
      })
    });
  } catch(e) { console.error('Email error:', e); }
}

async function tgSend(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

function getField(doc, field) {
  const f = doc.fields?.[field];
  return f?.stringValue || f?.integerValue || f?.booleanValue || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: 'OK' };

  try {
    const update  = JSON.parse(event.body);
    const message = update.message;
    if (!message || !message.text) return { statusCode: 200, body: 'OK' };

    const text   = message.text.trim().toUpperCase();
    const chatId = message.chat.id;

    if (text === 'CLOSE') {
      if (!message.reply_to_message) {
        await tgSend(chatId, 'Please reply directly to the ticket message with CLOSE.');
        return { statusCode: 200, body: 'OK' };
      }

      const repliedMsgId = message.reply_to_message.message_id;
      const doc = await findTicketByTelegramMsgId(repliedMsgId);

      if (!doc) {
        await tgSend(chatId, 'Could not find the ticket. Make sure to reply directly to the original ticket message.');
        return { statusCode: 200, body: 'OK' };
      }

      const ticketId    = doc.name.split('/').pop();
      const status      = getField(doc, 'status');

      if (status === 'closed') {
        await tgSend(chatId, `Ticket #${ticketId.slice(0,8).toUpperCase()} is already closed.`);
        return { statusCode: 200, body: 'OK' };
      }

      const ticket = {
        memberName:  getField(doc, 'memberName'),
        cabin:       getField(doc, 'cabin'),
        email:       getField(doc, 'email'),
        category:    getField(doc, 'category'),
        description: getField(doc, 'description')
      };

      await closeTicket(ticketId);
      await sendEmail(ticket, ticketId);

      await tgSend(chatId,
        `Ticket #${ticketId.slice(0,8).toUpperCase()} closed.\n\n` +
        `Member: ${ticket.memberName}\n` +
        `Cabin: ${ticket.cabin}\n` +
        `Category: ${ticket.category?.toUpperCase()}\n\n` +
        `Member has been notified by email.`
      );
    }

    return { statusCode: 200, body: 'OK' };
  } catch(e) {
    console.error('Webhook error:', e);
    return { statusCode: 200, body: 'OK' }; // Always return 200 to Telegram
  }
};
