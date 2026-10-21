export async function GET() { return Response.json({ error: "Legacy extrapolation retired", replacement: "/api/forecast/prediction" }, { status: 410 }); }
