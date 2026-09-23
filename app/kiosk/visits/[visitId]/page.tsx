import KioskPreparationClient from "./KioskPreparationClient";

export default async function KioskPreparationPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  return <KioskPreparationClient visitId={visitId} />;
}
