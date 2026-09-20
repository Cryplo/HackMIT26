import BusinessDashboard from "@/components/business/BusinessDashboard";

export const metadata = { title: "Reimbursements · Sift" };

export default async function BusinessDemoPage({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const preview = params.preview === "1";
  return <BusinessDashboard key={`${preview ? "preview" : "api"}:${typeof params.view === "string" ? params.view : "reviews"}`} preview={preview} />;
}
