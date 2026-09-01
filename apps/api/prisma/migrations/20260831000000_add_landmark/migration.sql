-- A standalone public landmark (e.g. a well-known roundabout) shown purely for
-- orientation on the customer address map. It has no relation to any Restaurant
-- and is unrelated to JOVO's own store data.
CREATE TABLE "Landmark" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Landmark_pkey" PRIMARY KEY ("id")
);
