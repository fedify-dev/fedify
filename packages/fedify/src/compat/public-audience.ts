import { getLogger } from "@logtape/logtape";
import { PUBLIC_COLLECTION } from "@fedify/vocab";

const logger = getLogger(["fedify", "compat", "public-audience"]);

export function normalizePublicFollowObject(
  jsonLd: unknown,
): unknown {
  if (typeof jsonLd !== "object" || jsonLd === null) {
    return jsonLd;
  }

  try {
    const record = jsonLd as Record<string, unknown>;
    if (
      record.type === "Follow" &&
      (record.object === "as:Public" || record.object === "Public")
    ) {
      const normalized = {
        ...record,
        object: PUBLIC_COLLECTION.href,
      };

      return normalized;
    }
  } catch (error) {
    logger.debug(
      "Failed to normalize public follow object; sending the activity as is.\n{error}",
      {
        error,
      },
    );
  }

  return jsonLd;
}
