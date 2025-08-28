import cron from "node-cron";
import { getDomains } from "@/services/domain";
import { sendDomainExpiryNotification } from "@/services/notification";

export const initScheduledJobs = () => {
  // Schedule a job to run every day at 7:00 AM
  cron.schedule("0 7 * * *", async () => {
    console.log("Running daily domain expiry check...");

    const { WA_API_URL, WA_GROUP_ID, WA_USERNAME, WA_PASSWORD } = process.env;

    if (!WA_API_URL || !WA_GROUP_ID || !WA_USERNAME || !WA_PASSWORD) {
      console.error(
        "WhatsApp credentials are not fully configured in environment variables. Skipping domain expiry notification.",
      );
      return;
    }

    const whatsappCreds = {
      apiUrl: WA_API_URL,
      groupId: WA_GROUP_ID,
      username: WA_USERNAME,
      password: WA_PASSWORD,
    };

    try {
      const domains = await getDomains();
      console.log(
        "Fetched domains from database:",
        JSON.stringify(domains, null, 2),
      );
      const twoMonthsFromNow = new Date();
      twoMonthsFromNow.setMonth(twoMonthsFromNow.getMonth() + 2);
      console.log(
        `Checking for domains expiring before: ${twoMonthsFromNow.toISOString()}`,
      );

      const expiringDomains = domains.filter((domain) => {
        if (!domain.expiresAt) return false;
        const expiryDate = new Date(domain.expiresAt);
        return expiryDate < twoMonthsFromNow;
      });

      if (expiringDomains.length > 0) {
        console.log(
          `Found ${expiringDomains.length} expiring domains. Sending notification...`,
        );
        await sendDomainExpiryNotification(whatsappCreds, expiringDomains);
      } else {
        console.log("No expiring domains found.");
      }
    } catch (error) {
      console.error("Error during scheduled domain expiry check:", error);
    }
  });

  console.log("Scheduled jobs initialized.");
};
