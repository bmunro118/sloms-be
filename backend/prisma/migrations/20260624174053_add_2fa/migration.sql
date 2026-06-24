-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "TotpSecret" TEXT,
ADD COLUMN     "TwoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "TwoFactorEnrolledAt" TIMESTAMP(3),
ADD COLUMN     "TwoFactorMethod" VARCHAR(10);

-- CreateTable
CREATE TABLE "TrustedDevices" (
    "Id" SERIAL NOT NULL,
    "UserID" INTEGER NOT NULL,
    "TokenHash" VARCHAR(64) NOT NULL,
    "Label" VARCHAR(200),
    "UserAgent" VARCHAR(500),
    "IPAddress" VARCHAR(45),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "LastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ExpiresAt" TIMESTAMP(3) NOT NULL,
    "RevokedAt" TIMESTAMP(3),

    CONSTRAINT "TrustedDevices_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "EmailOtps" (
    "Id" SERIAL NOT NULL,
    "UserID" INTEGER NOT NULL,
    "CodeHash" VARCHAR(64) NOT NULL,
    "ExpiresAt" TIMESTAMP(3) NOT NULL,
    "Attempts" INTEGER NOT NULL DEFAULT 0,
    "ConsumedAt" TIMESTAMP(3),
    "CreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOtps_pkey" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "RecoveryCodes" (
    "Id" SERIAL NOT NULL,
    "UserID" INTEGER NOT NULL,
    "CodeHash" VARCHAR(64) NOT NULL,
    "UsedAt" TIMESTAMP(3),

    CONSTRAINT "RecoveryCodes_pkey" PRIMARY KEY ("Id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrustedDevices_TokenHash_key" ON "TrustedDevices"("TokenHash");

-- CreateIndex
CREATE INDEX "TrustedDevices_UserID_idx" ON "TrustedDevices"("UserID");

-- CreateIndex
CREATE INDEX "EmailOtps_UserID_idx" ON "EmailOtps"("UserID");

-- CreateIndex
CREATE INDEX "RecoveryCodes_UserID_idx" ON "RecoveryCodes"("UserID");

-- AddForeignKey
ALTER TABLE "TrustedDevices" ADD CONSTRAINT "TrustedDevices_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "Users"("UserID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOtps" ADD CONSTRAINT "EmailOtps_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "Users"("UserID") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCodes" ADD CONSTRAINT "RecoveryCodes_UserID_fkey" FOREIGN KEY ("UserID") REFERENCES "Users"("UserID") ON DELETE CASCADE ON UPDATE CASCADE;
