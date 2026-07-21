export const metadata = { title: "Pricing — The Same Page" };

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-semibold">Pricing</h1>
      <div className="mt-8 rounded-lg border border-gray-200 p-8">
        <p className="text-4xl font-semibold">$20<span className="text-base font-normal text-gray-500">/month</span></p>
        <p className="mt-2 text-gray-600">Cancel anytime. No procurement, no seats, just you.</p>
        <a href="/app/login" className="mt-6 inline-block rounded-md bg-gray-900 px-5 py-3 text-white">
          Start free trial
        </a>
      </div>
    </main>
  );
}
