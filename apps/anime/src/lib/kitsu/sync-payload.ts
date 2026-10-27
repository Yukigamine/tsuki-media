import { z } from "zod";

const KitsuMappingSchema = z.object({
  externalId: z.string(),
  externalSite: z.string(),
});

const KitsuTitlesSchema = z.object({
  canonical: z.string().nullable().optional(),
  translated: z.string().nullable().optional(),
  romanized: z.string().nullable().optional(),
  original: z.string().nullable().optional(),
});

const KitsuImageSchema = z.object({
  original: z
    .object({
      url: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const KitsuMediaSchema = z.object({
  id: z.string(),
  slug: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  averageRating: z.number().nullable().optional(),
  description: z
    .union([z.string(), z.record(z.string(), z.string())])
    .nullable()
    .optional(),
  posterImage: KitsuImageSchema.nullable().optional(),
  bannerImage: KitsuImageSchema.nullable().optional(),
  titles: KitsuTitlesSchema.nullable().optional(),
  mappings: z
    .object({
      nodes: z.array(KitsuMappingSchema).nullable().optional(),
    })
    .nullable()
    .optional(),
  episodeCount: z.number().int().nullable().optional(),
  chapterCount: z.number().int().nullable().optional(),
  volumeCount: z.number().int().nullable().optional(),
});

const KitsuLibraryEntrySchema = z.object({
  id: z.string(),
  notes: z.string().nullable().optional(),
  private: z.boolean().nullable().optional(),
  progress: z.number().int().nullable().optional(),
  rating: z.number().nullable().optional(),
  reconsumeCount: z.number().int().nullable().optional(),
  reconsuming: z.boolean().nullable().optional(),
  status: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  media: KitsuMediaSchema,
});

export const KitsuLibrarySyncPayloadSchema = z.object({
  slug: z.string().min(1),
  anime: z.array(KitsuLibraryEntrySchema),
  manga: z.array(KitsuLibraryEntrySchema),
});

export type KitsuLibraryEntry = z.infer<typeof KitsuLibraryEntrySchema>;
export type KitsuLibrarySyncPayload = z.infer<
  typeof KitsuLibrarySyncPayloadSchema
>;
