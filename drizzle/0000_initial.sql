CREATE TABLE `accounting_sync_leases` (
	`position_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`expires_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `discord_report_messages` (
	`message_id` text PRIMARY KEY NOT NULL,
	`message_key` text NOT NULL,
	`kind` text NOT NULL,
	`position_id` text,
	`generation` text NOT NULL,
	`status` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `discord_report_messages_status_idx` ON `discord_report_messages` (`status`);--> statement-breakpoint
CREATE TABLE `position_accounting` (
	`position_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`deposited_usdg` real,
	`withdrawn_usdg` real,
	`claimed_fees_usdg` real,
	`last_synced_block` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `position_cashflows_v2` (
	`position_id` text NOT NULL,
	`tx_hash` text NOT NULL,
	`log_index` integer NOT NULL,
	`block_number` text NOT NULL,
	`timestamp_ms` integer NOT NULL,
	`type` text NOT NULL,
	`token0_raw` text NOT NULL,
	`token1_raw` text NOT NULL,
	`value_usdg` real NOT NULL,
	PRIMARY KEY(`position_id`, `tx_hash`, `log_index`, `type`)
);
--> statement-breakpoint
CREATE INDEX `position_cashflows_position_block_idx` ON `position_cashflows_v2` (`position_id`,`block_number`);--> statement-breakpoint
CREATE TABLE `position_status` (
	`position_id` text PRIMARY KEY NOT NULL,
	`last_status` text,
	`out_of_range_since_ms` integer
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`position_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`manager` text NOT NULL,
	`token_id` text NOT NULL,
	`mint_timestamp_ms` integer,
	`mint_block` text
);
--> statement-breakpoint
CREATE TABLE `reference_pools` (
	`pool_key` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`pool_address` text NOT NULL,
	`token0_address` text NOT NULL,
	`token1_address` text NOT NULL,
	`fee_tier` integer NOT NULL,
	`liquidity` text NOT NULL,
	`discovered_block` text NOT NULL,
	`refreshed_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reference_pools_pair_idx` ON `reference_pools` (`token0_address`,`token1_address`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `token_metadata` (
	`address` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`decimals` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet_positions` (
	`wallet_address` text NOT NULL,
	`position_id` text NOT NULL,
	`last_seen_at_ms` integer NOT NULL,
	PRIMARY KEY(`wallet_address`, `position_id`)
);
--> statement-breakpoint
CREATE INDEX `wallet_positions_position_idx` ON `wallet_positions` (`position_id`);
