import HumanDashboard from "@/components/business/HumanDashboard";

export const metadata = { title: "Overview · Sift" };

export default async function OverviewPage({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const preview = params.preview === "1";
  return <HumanDashboard key={preview ? "preview" : "api"} preview={preview} />;
}
