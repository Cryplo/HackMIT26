import InvestigationsWorkspace from "@/components/business/InvestigationsWorkspace";

export const metadata = { title: "Investigations · Sift" };

export default async function InvestigationsPage({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const preview = params.preview === "1";
  return <InvestigationsWorkspace key={preview ? "preview" : "api"} preview={preview} initialRun={typeof params.run === "string" ? params.run : null} />;
}
