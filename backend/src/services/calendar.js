import { google } from "googleapis";
import prisma from "../utils/db.js";

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(state) {
  const oAuth2Client = getOAuthClient();
  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    state,
  });
}

export async function handleOAuthCallback(code, userId) {
  const oAuth2Client = getOAuthClient();
  const { tokens } = await oAuth2Client.getToken(code);
  await prisma.googleToken.upsert({
    where: { userId },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: new Date(tokens.expiry_date),
    },
    create: {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: new Date(tokens.expiry_date),
    },
  });
}

async function getClientForUser(userId) {
  const tokenRow = await prisma.googleToken.findUnique({ where: { userId } });
  if (!tokenRow) return null; // user hasn't connected Google Calendar
  const oAuth2Client = getOAuthClient();
  oAuth2Client.setCredentials({
    access_token: tokenRow.accessToken,
    refresh_token: tokenRow.refreshToken,
  });
  return oAuth2Client;
}

/**
 * Creates a calendar event for a given user (patient or doctor) if they've
 * connected Google Calendar. If not connected, this is a no-op — calendar
 * sync is a nice-to-have on top of the core booking flow, never a blocker.
 */
export async function createCalendarEvent(userId, { summary, description, start, end }) {
  try {
    const auth = await getClientForUser(userId);
    if (!auth) return null;
    const calendar = google.calendar({ version: "v3", auth });
    const event = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary,
        description,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      },
    });
    return event.data.id;
  } catch (err) {
    console.error("[calendar] createCalendarEvent failed:", err.message);
    return null;
  }
}

export async function updateCalendarEvent(userId, eventId, { summary, description, start, end }) {
  try {
    const auth = await getClientForUser(userId);
    if (!auth || !eventId) return;
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: {
        summary,
        description,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      },
    });
  } catch (err) {
    console.error("[calendar] updateCalendarEvent failed:", err.message);
  }
}

export async function deleteCalendarEvent(userId, eventId) {
  try {
    const auth = await getClientForUser(userId);
    if (!auth || !eventId) return;
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (err) {
    console.error("[calendar] deleteCalendarEvent failed:", err.message);
  }
}
