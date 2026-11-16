import type { CompanyKey } from "./companies";
import { DocumentSignature } from "./models";

export type Signature = { name: string; title: string };

export async function companySignature(company: CompanyKey) {
  const item = await DocumentSignature.findOne({ company }).select("name title").lean<Signature>();
  return item ? { name: item.name, title: item.title } : undefined;
}
