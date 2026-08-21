import { Router } from "express";
import prisma from "../utils/db.js";
import { requireAuth } from "../middleware/auth.js";
import { getAuthUrl, handleOAuthCallback, createOAuthState, verifyOAuthState } from "../services/calendar.js";

const router = Router();

// Returns the Google consent URL with a one-time server-side state token
router.get("/oauth/url", requireAuth, async (req, res) => {
  try {
    const signedState = await createOAuthState(req.user.id);
    const url = getAuthUrl(signedState);
    res.json({ url });
  } catch (err) {
    console.error("[calendar] Failed to create OAuth url:", err.message);
    res.status(500).json({ error: "Failed to generate OAuth URL" });
  }
});

// Google redirects here after consent — validates one-time state and expiration
router.get("/oauth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!state || !code) {
    return res.status(400).send("<h3>Missing authorization code or state parameter.</h3>");
  }

  const userId = await verifyOAuthState(state);
  if (!userId) {
    return res.status(400).send("<h3>Invalid or expired OAuth state. Please try connecting your calendar again.</h3>");
  }

  try {
    await handleOAuthCallback(code, userId);
    res.send("<h3>Google Calendar connected successfully! You can close this tab and return to the clinic portal.</h3>");
  } catch (err) {
    console.error("[calendar] OAuth callback error:", err.message);
    res.status(500).send("<h3>Failed to connect Google Calendar.</h3>");
  }
});

// Check if authenticated user has connected Google Calendar
router.get("/status", requireAuth, async (req, res) => {
  const tokenRow = await prisma.googleToken.findUnique({
    where: { userId: req.user.id },
    select: { id: true, expiryDate: true },
  });
  res.json({ connected: Boolean(tokenRow) });
});

export default router;
