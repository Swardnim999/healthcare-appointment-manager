import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getAuthUrl, handleOAuthCallback } from "../services/calendar.js";

const router = Router();

// Returns the Google consent URL for the logged-in user to connect their calendar
router.get("/oauth/url", requireAuth, (req, res) => {
  const url = getAuthUrl(req.user.id); // state = userId, so callback knows who to attach tokens to
  res.json({ url });
});

// Google redirects here after consent
router.get("/oauth/callback", async (req, res) => {
  const { code, state: userId } = req.query;
  try {
    await handleOAuthCallback(code, userId);
    res.send("<h3>Google Calendar connected. You can close this tab.</h3>");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to connect Google Calendar.");
  }
});

export default router;
