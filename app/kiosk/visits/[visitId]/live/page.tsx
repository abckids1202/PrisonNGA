import LiveSessionClient from "@/app/features/live-session/LiveSessionClient";

export default async function KioskLivePage({ params, searchParams }: { params: Promise<{ visitId: string }>; searchParams: Promise<{ kiosk?: string }> }) {
  const { visitId } = await params;
  const { kiosk } = await searchParams;
  return <LiveSessionClient visitId={visitId} role="FACILITY" kioskId={kiosk} />;
}
