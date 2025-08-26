import { db } from "../db";
import { domains } from "../db/schema";
import { eq, like } from "drizzle-orm";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function getWhoisInfo(domainName: string) {
  try {
    const { stdout } = await execAsync(`whois ${domainName}`);
    // A more robust parser to handle colons in values
    const lines = stdout.split("\n");
    const whoisData: any = {};
    lines.forEach((line) => {
      const colonIndex = line.indexOf(":");
      if (colonIndex > -1) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        whoisData[key] = value;
      }
    });

    const expiresAt = whoisData["Registry Expiry Date"]
      ? new Date(whoisData["Registry Expiry Date"])
      : null;
    const lastChangedAt = whoisData["Updated Date"]
      ? new Date(whoisData["Updated Date"])
      : null;
    const status = whoisData["Domain Status"] || null;

    return { whoisData, expiresAt, lastChangedAt, status };
  } catch (error) {
    console.error(`Error fetching WHOIS for ${domainName}:`, error);
    throw new Error("Failed to fetch WHOIS information.");
  }
}

export const getDomains = async () => {
  try {
    return await db.select().from(domains);
  } catch (error) {
    console.error("Error in getDomains:", error);
    throw error;
  }
};

export const getDomain = async (id: number) => {
  try {
    const result = await db.select().from(domains).where(eq(domains.id, id));
    return result[0];
  } catch (error) {
    console.error("Error in getDomain:", error);
    throw error;
  }
};

export const getDomainByName = async (name: string) => {
  try {
    const result = await db
      .select()
      .from(domains)
      .where(like(domains.name, `%${name}%`));
    return result[0];
  } catch (error) {
    console.error("Error in getDomainByName:", error);
    throw error;
  }
};

export const createDomain = async (name: string) => {
  try {
    const { whoisData, expiresAt, lastChangedAt, status } = await getWhoisInfo(
      name,
    );
    const newDomain = await db
      .insert(domains)
      .values({
        name,
        whois: whoisData,
        expiresAt,
        lastChangedAt,
        status,
        updatedAt: new Date(),
      })
      .returning();
    return newDomain[0];
  } catch (error) {
    console.error("Error in createDomain:", error);
    throw error;
  }
};

export const refreshDomain = async (id: number) => {
  try {
    const domain = await getDomain(id);
    if (!domain) {
      return null;
    }
    const { whoisData, expiresAt, lastChangedAt, status } = await getWhoisInfo(
      domain.name,
    );
    const updatedDomain = await db
      .update(domains)
      .set({
        whois: whoisData,
        expiresAt,
        lastChangedAt,
        status,
        updatedAt: new Date(),
      })
      .where(eq(domains.id, id))
      .returning();
    return updatedDomain[0];
  } catch (error) {
    console.error("Error in refreshDomain:", error);
    throw error;
  }
};

export const deleteDomain = async (id: number) => {
  try {
    const result = await db.delete(domains).where(eq(domains.id, id)).returning();
    return result[0];
  } catch (error) {
    console.error("Error in deleteDomain:", error);
    throw error;
  }
};
