import { PrismaClient } from "@prisma/client";

// Single shared Prisma instance across the app (avoids exhausting connections
// during hot-reload in dev, and is the recommended pattern for serverless too).
const prisma = new PrismaClient();

export default prisma;
