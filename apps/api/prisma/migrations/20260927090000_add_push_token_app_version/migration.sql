-- The installed app binary version per push token, so alert channels/sounds are only addressed
-- to builds that contain them. Nullable: tokens from builds before 0.17.0 never report it.
ALTER TABLE "PushToken" ADD COLUMN "appVersion" TEXT;
