import ReceiptClient from "./ReceiptClient";

export default async function VisitorReceiptPage({ params }: { params: Promise<{ paymentIntentId: string }> }) {
  const { paymentIntentId } = await params;
  return <ReceiptClient paymentIntentId={paymentIntentId} />;
}
