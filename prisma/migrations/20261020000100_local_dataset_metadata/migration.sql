CREATE TABLE "dataset_metadata" (
  "id" TEXT NOT NULL DEFAULT 'local',
  "as_of" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_count" INTEGER NOT NULL,
  CONSTRAINT "dataset_metadata_pkey" PRIMARY KEY ("id")
);
