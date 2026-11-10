CREATE TYPE "public"."alert_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."sentiment_label" AS ENUM('POSITIVE', 'NEUTRAL', 'NEGATIVE');--> statement-breakpoint
CREATE TYPE "public"."source_platform" AS ENUM('NEWS_MEDIA', 'TWITTER_X', 'YOUTUBE', 'TIKTOK');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword_id" uuid,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"severity" "alert_severity" DEFAULT 'MEDIUM' NOT NULL,
	"metrics_snapshot" jsonb,
	"is_resolved" text DEFAULT 'false' NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"media_item_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"platform" "source_platform" NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"author" varchar(255),
	"title" text NOT NULL,
	"raw_content" text NOT NULL,
	"clean_content" text NOT NULL,
	"sentiment" "sentiment_label" NOT NULL,
	"sentiment_score" real NOT NULL,
	"entities" jsonb DEFAULT '{"persons":[],"organizations":[],"locations":[]}'::jsonb NOT NULL,
	"embedding" vector(768),
	"published_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitored_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar(100) NOT NULL,
	"boolean_query" text NOT NULL,
	"is_active" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"domain" varchar(150) NOT NULL,
	"platform" "source_platform" DEFAULT 'NEWS_MEDIA' NOT NULL,
	"rss_url" text,
	"is_active" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "topic_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"dominant_sentiment" "sentiment_label",
	"total_articles" real DEFAULT 0 NOT NULL,
	"centroid" vector(768),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_keyword_id_monitored_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."monitored_keywords"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_items" ADD CONSTRAINT "cluster_items_cluster_id_topic_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."topic_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_items" ADD CONSTRAINT "cluster_items_media_item_id_media_items_id_fk" FOREIGN KEY ("media_item_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_alerts_triggered_at" ON "alerts" USING btree ("triggered_at");--> statement-breakpoint
CREATE INDEX "idx_alerts_severity" ON "alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_alerts_resolved" ON "alerts" USING btree ("is_resolved");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cluster_media" ON "cluster_items" USING btree ("cluster_id","media_item_id");--> statement-breakpoint
CREATE INDEX "idx_cluster_items_media" ON "cluster_items" USING btree ("media_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_media_external_id" ON "media_items" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "idx_media_published_at" ON "media_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_media_sentiment" ON "media_items" USING btree ("sentiment");--> statement-breakpoint
CREATE INDEX "idx_media_source" ON "media_items" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_media_platform" ON "media_items" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "idx_media_embedding_hnsw" ON "media_items" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_clusters_last_updated" ON "topic_clusters" USING btree ("last_updated");