import { google } from "googleapis";
import crypto from "crypto";
import prisma from "../utils/db.js";

let mockCalendarClient = null;

export function setCalendarClientMock(mock) {
  mockCalendarClient = mock;
}

export function getCalendarClientMock() {
  return mockCalendarClient;
}

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Creates a cryptographically random, one-time, time-limited OAuth state token
 * stored in the OAuthState table.
 */
export async function createOAuthState(userId) {
  const state = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min expiry
  await prisma.oAuthState.create({
    data: {
      state,
      userId,
      expiresAt,
    },
  });
  return state;
}

/**
 * Atomically verifies and consumes the one-time OAuth state token.
 * Prevents replay attacks by marking used=true.
 * Returns the userId if valid and unused, or null if invalid/used/expired.
 */
export async function verifyOAuthState(state) {
  if (!state || typeof state !== "string") return null;
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.oAuthState.findUnique({ where: { state } });
      if (!row) return null;
      if (row.used) return null; // already consumed -> replay prevented
      if (new Date() > row.expiresAt) return null; // expired

      await tx.oAuthState.update({
        where: { state },
        data: { used: true },
      });

      return row.userId;
    });
  } catch {
    return null;
  }
}

export function getAuthUrl(signedState) {
  const oAuth2Client = getOAuthClient();
  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    state: signedState,
  });
}

export async function handleOAuthCallback(code, userId) {
  if (mockCalendarClient) {
    await prisma.googleToken.upsert({
      where: { userId },
      update: {
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
        expiryDate: new Date(Date.now() + 3600000),
      },
      create: {
        userId,
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
        expiryDate: new Date(Date.now() + 3600000),
      },
    });
    return;
  }

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
  if (mockCalendarClient) {
    return mockCalendarClient;
  }
  const tokenRow = await prisma.googleToken.findUnique({ where: { userId } });
  if (!tokenRow) return null; // user hasn't connected Google Calendar
  const oAuth2Client = getOAuthClient();
  oAuth2Client.setCredentials({
    access_token: tokenRow.accessToken,
    refreshToken: tokenRow.refreshToken,
  });
  return oAuth2Client;
}

/**
 * Creates a calendar event for a given user (patient or doctor) if they've
 * connected Google Calendar. If not connected or if the API fails, this
 * gracefully fails and logs without breaking the booking flow.
 */
export async function createCalendarEvent(userId, { summary, description, start, end }) {
  try {
    const auth = await getClientForUser(userId);
    if (!auth) return null;

    if (mockCalendarClient && typeof mockCalendarClient.createEvent === "function") {
      return await mockCalendarClient.createEvent(userId, { summary, description, start, end });
    }

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

    if (mockCalendarClient && typeof mockCalendarClient.updateEvent === "function") {
      return await mockCalendarClient.updateEvent(userId, eventId, { summary, description, start, end });
    }

    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.patch({
      calendarId: "primary",
      eventId,
      requestBody: {
        ...(summary && { summary }),
        ...(description && { description }),
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

    if (mockCalendarClient && typeof mockCalendarClient.deleteEvent === "function") {
      return await mockCalendarClient.deleteEvent(userId, eventId);
    }

    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (err) {
    console.error("[calendar] deleteCalendarEvent failed:", err.message);
  }
}
