import { redirect } from "next/navigation";

export default async function Home({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  redirect(params.preview === "1" ? "/overview?preview=1" : "/overview");
}
