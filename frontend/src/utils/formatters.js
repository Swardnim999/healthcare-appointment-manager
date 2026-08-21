/**
 * Formats doctor name cleanly, ensuring exactly one "Dr. " prefix without duplication.
 * Works seamlessly with both "Anjali Rao" and "Dr. Anjali Rao".
 */
export function formatDoctorName(name) {
  if (!name || typeof name !== "string") return "Doctor";
  const trimmed = name.trim();
  if (!trimmed) return "Doctor";

  // Check if name already starts with "Dr." or "Dr " (case-insensitive)
  if (/^dr\.?\s+/i.test(trimmed)) {
    const cleanName = trimmed.replace(/^dr\.?\s+/i, "").trim();
    return `Dr. ${cleanName}`;
  }

  return `Dr. ${trimmed}`;
}

/**
 * Extracts 2-letter initials for a doctor, cleanly ignoring any leading "Dr." prefix.
 * e.g., "Dr. Anjali Rao" -> "AR", "Anjali Rao" -> "AR"
 */
export function getDoctorInitials(name) {
  if (!name || typeof name !== "string") return "DR";
  const cleanName = name.replace(/^dr\.?\s+/i, "").trim();
  if (!cleanName) return "DR";

  const parts = cleanName.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
