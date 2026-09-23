import StaffObserverRouteClient from "@/app/features/live-session/StaffObserverRouteClient";

export default async function StaffObserverPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <StaffObserverRouteClient sessionId={sessionId} />;
}

