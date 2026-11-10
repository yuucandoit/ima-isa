CREATE TABLE "social_trends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "source_platform" DEFAULT 'TWITTER_X' NOT NULL,
	"region" varchar(100) DEFAULT 'Indonesia' NOT NULL,
	"woeid" integer,
	"name" text NOT NULL,
	"rank" integer,
	"tweet_volume" integer,
	"url" text,
	"raw" jsonb,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_social_trends_captured" ON "social_trends" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "idx_social_trends_platform" ON "social_trends" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "idx_social_trends_name" ON "social_trends" USING btree ("name");