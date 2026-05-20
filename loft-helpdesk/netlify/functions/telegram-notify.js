const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const PROJECT_ID = 'loft-finance';

const ROUTING = {
  cleaning: process.env.TELEGRAM_ID_ANKUR,
  ac:       process.env.TELEGRAM_ID_ANKUR,
  electrical: process.env.TELEGRAM_ID_PURTI,
  general:  process.env.TELEGRAM_ID_PURTI
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const ticket = JSON.parse(event.body);
    const chatId = ROUTING[ticket.category] || ROUTING.general;

    const msg =
      `New LOFT Ticket\n\n` +
      `Ticket: #${ticket.ticketId.slice(0,8).toUpperCase()}\n` +
      `Category: ${ticket.category.toUpperCase()}\n` +
      `Member: ${ticket.memberName}\n` +
      `Cabin: ${ticket.cabin}\n` +
      `Email: ${ticket.email || 'N/A'}\n\n` +
      `Issue:\n${ticket.description}\n\n` +
      `Reply CLOSE to this message to close the ticket.`;

    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg })
    });

    const tgData = await tgRes.json();

    // Save Telegram message ID to Firestore so we can match CLOSE replies
    if (tgData.ok && ticket.ticketId) {
      const telegramMsgId = tgData.result.message_id;
      await fetch(
        `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/loft_tickets/${ticket.ticketId}?updateMask.fieldPaths=telegramMessageId&updateMask.fieldPaths=telegramChatId&key=${FIREBASE_API_KEY}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              telegramMessageId: { integerValue: telegramMsgId },
              telegramChatId:    { stringValue: String(chatId) }
            }
          })
        }
      );
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch(e) {
    console.error('telegram-notify error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
