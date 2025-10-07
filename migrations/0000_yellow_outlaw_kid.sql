CREATE TABLE "auth_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"user_agent" text,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"phone" text,
	"email" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_count_lines" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_count_id" varchar NOT NULL,
	"inventory_item_id" varchar NOT NULL,
	"qty" real NOT NULL,
	"unit_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"counted_at" timestamp DEFAULT now() NOT NULL,
	"storage_location_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "inventory_item_price_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" varchar NOT NULL,
	"effective_at" timestamp NOT NULL,
	"cost_per_case" real NOT NULL,
	"vendor_item_id" varchar,
	"note" text,
	"recorded_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"plu_sku" text,
	"unit_id" varchar NOT NULL,
	"case_size" real DEFAULT 20 NOT NULL,
	"barcode" text,
	"active" integer DEFAULT 1 NOT NULL,
	"last_cost" real DEFAULT 0 NOT NULL,
	"storage_location_id" varchar NOT NULL,
	"on_hand_qty" real DEFAULT 0 NOT NULL,
	"image_url" text,
	"par_level" real,
	"reorder_level" real,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plu_sku" text NOT NULL,
	"recipe_id" varchar NOT NULL,
	"serving_size_qty" real DEFAULT 1 NOT NULL,
	"serving_unit_id" varchar NOT NULL,
	CONSTRAINT "menu_items_plu_sku_unique" UNIQUE("plu_sku")
);
--> statement-breakpoint
CREATE TABLE "po_lines" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" varchar NOT NULL,
	"vendor_item_id" varchar NOT NULL,
	"ordered_qty" real NOT NULL,
	"unit_id" varchar NOT NULL,
	"price_each" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_sales" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar DEFAULT 'main' NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_sales_lines" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pos_sales_id" varchar NOT NULL,
	"plu_sku" text NOT NULL,
	"qty_sold" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expected_date" timestamp
);
--> statement-breakpoint
CREATE TABLE "receipt_lines" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" varchar NOT NULL,
	"vendor_item_id" varchar NOT NULL,
	"received_qty" real NOT NULL,
	"unit_id" varchar NOT NULL,
	"price_each" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" varchar NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_components" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" varchar NOT NULL,
	"component_type" text NOT NULL,
	"component_id" varchar NOT NULL,
	"qty" real NOT NULL,
	"unit_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" varchar NOT NULL,
	"version_number" integer NOT NULL,
	"yield_qty" real NOT NULL,
	"yield_unit_id" varchar NOT NULL,
	"waste_percent" real DEFAULT 0 NOT NULL,
	"computed_cost" real DEFAULT 0 NOT NULL,
	"components" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"yield_qty" real NOT NULL,
	"yield_unit_id" varchar NOT NULL,
	"waste_percent" real DEFAULT 0 NOT NULL,
	"computed_cost" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_system" text DEFAULT 'imperial' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"pos_system" text,
	"pos_api_key" text,
	"pos_webhook_url" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" varchar NOT NULL,
	"from_location_id" varchar NOT NULL,
	"to_location_id" varchar NOT NULL,
	"qty" real NOT NULL,
	"unit_id" varchar NOT NULL,
	"transferred_at" timestamp DEFAULT now() NOT NULL,
	"transferred_by" varchar,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "unit_conversions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_unit_id" varchar NOT NULL,
	"to_unit_id" varchar NOT NULL,
	"conversion_factor" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"to_base_ratio" real NOT NULL,
	"system" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendor_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" varchar NOT NULL,
	"inventory_item_id" varchar NOT NULL,
	"vendor_sku" text,
	"purchase_unit_id" varchar NOT NULL,
	"case_size" real DEFAULT 1 NOT NULL,
	"inner_pack_size" real,
	"last_price" real DEFAULT 0 NOT NULL,
	"lead_time_days" integer,
	"active" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"account_number" text
);
--> statement-breakpoint
CREATE TABLE "waste_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" varchar NOT NULL,
	"storage_location_id" varchar NOT NULL,
	"qty" real NOT NULL,
	"unit_id" varchar NOT NULL,
	"reason_code" text NOT NULL,
	"notes" text,
	"wasted_at" timestamp DEFAULT now() NOT NULL,
	"logged_by" varchar
);
