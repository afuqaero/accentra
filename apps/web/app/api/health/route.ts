import { envStatus } from "../../../lib/env";
import { adapterStatus } from "../../../lib/autocount";
export function GET() { return Response.json({ status: "ok", service: "accentra-web", timestamp: new Date().toISOString(), dependencies: envStatus(), autocount: adapterStatus() }); }
