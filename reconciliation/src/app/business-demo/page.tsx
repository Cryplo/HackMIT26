import BusinessDashboard from "@/components/business/BusinessDashboard";

export const metadata = { title: "Reimbursements · Fieldnotes" };

export default async function BusinessDemoPage({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const preview = params.preview === "1";
  return <BusinessDashboard key={preview ? "preview" : "api"} preview={preview} />;
}
