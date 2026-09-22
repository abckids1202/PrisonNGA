import VisitorVisitDetailsClient from "../../VisitDetailsClient";

export default async function VisitorVisitDetailsPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  return <VisitorVisitDetailsClient key={visitId} visitId={visitId} />;
}
