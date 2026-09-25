import PaymentStatusClient from "./PaymentStatusClient";

export default async function VisitorPaymentPage({ params }: { params: Promise<{ paymentIntentId: string }> }) {
  const { paymentIntentId } = await params;
  return <PaymentStatusClient paymentIntentId={paymentIntentId} />;
}
