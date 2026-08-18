import LiveSessionClient from "@/app/features/live-session/LiveSessionClient";

export default async function VisitorLivePage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  return <LiveSessionClient visitId={visitId} role="VISITOR" />;
}
