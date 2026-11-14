CREATE TYPE "public"."clip_dist_status" AS ENUM('queued', 'uploading', 'published', 'boosting', 'shadowbanned', 'failed');--> statement-breakpoint
CREATE TYPE "public"."clip_render_mode" AS ENUM('split_screen', 'face_reframe', 'blur_background');--> statement-breakpoint
CREATE TYPE "public"."clip_source_status" AS ENUM('pending', 'downloading', 'transcribing', 'analyzing', 'rendering', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "clip_distributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"clip_id" integer NOT NULL,
	"target_platform" text NOT NULL,
	"account_username" text NOT NULL,
	"device_serial" text,
	"mutated_file_path" text,
	"post_url" text,
	"status" "clip_dist_status" DEFAULT 'queued' NOT NULL,
	"views_count" integer DEFAULT 0 NOT NULL,
	"likes_count" integer DEFAULT 0 NOT NULL,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"shares_count" integer DEFAULT 0 NOT NULL,
	"saves_count" integer DEFAULT 0 NOT NULL,
	"trigger_count_applied" integer DEFAULT 0 NOT NULL,
	"cpm_rate_idr" integer DEFAULT 0 NOT NULL,
	"estimated_revenue_idr" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"last_scraped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clip_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"platform" text NOT NULL,
	"title" text,
	"duration_seconds" integer,
	"raw_file_path" text,
	"transcript_json" jsonb,
	"heatmap_json" jsonb,
	"status" "clip_source_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_clips" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"title_hook" text NOT NULL,
	"start_time" real NOT NULL,
	"end_time" real NOT NULL,
	"virality_score" integer NOT NULL,
	"ai_reasoning" text,
	"render_mode" "clip_render_mode" DEFAULT 'split_screen' NOT NULL,
	"filler_asset_used" text,
	"output_file_path" text,
	"file_hash" text,
	"is_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clip_distributions" ADD CONSTRAINT "clip_distributions_clip_id_generated_clips_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."generated_clips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_clips" ADD CONSTRAINT "generated_clips_source_id_clip_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."clip_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_clip_distributions_clip" ON "clip_distributions" USING btree ("clip_id");--> statement-breakpoint
CREATE INDEX "idx_clip_distributions_status" ON "clip_distributions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_clip_distributions_account" ON "clip_distributions" USING btree ("account_username");--> statement-breakpoint
CREATE INDEX "idx_clip_distributions_published" ON "clip_distributions" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_clip_sources_status" ON "clip_sources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_clip_sources_created" ON "clip_sources" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_generated_clips_source" ON "generated_clips" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_generated_clips_score" ON "generated_clips" USING btree ("virality_score");