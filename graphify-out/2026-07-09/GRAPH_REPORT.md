# Graph Report - .  (2026-07-09)

## Corpus Check
- Large corpus: 1008 files · ~1,179,720 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 4948 nodes · 13193 edges · 238 communities (190 shown, 48 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 85 edges (avg confidence: 0.73)
- Token cost: 161,997 input · 0 output

## Community Hubs (Navigation)
- WhatsApp Media & Icons
- App Shell & Route Guards
- Order Contact Actions
- Order Form & Provider Adapters
- Dashboard Stat Rows
- Business & Profile Modals
- WhatsApp Quick Replies & Steps
- Business Form & Form Primitives
- WhatsApp Inbox Handlers
- Order Status Dialogs
- WhatsApp Evolution Handlers
- NPM Dependencies
- App Pages
- WhatsApp Node Worker
- App Pages
- Shared Libs & Utils
- WhatsApp UI Components
- WhatsApp Inbox State
- WhatsApp Conversations
- UI Components
- App Pages
- WhatsApp Ops
- WhatsApp Ops
- App Pages
- App Pages
- Shared Libs
- UI Components
- App Pages
- App Pages
- App Pages
- Shared Libs
- UI Components
- Shared Libs
- WhatsApp Ops
- WhatsApp Ops
- WhatsApp Frontend
- WhatsApp Ops
- WhatsApp Frontend
- React Hooks
- App Pages
- WhatsApp Frontend
- WhatsApp Frontend
- Edge Functions
- Shared Libs
- WhatsApp Frontend
- Shared Libs
- App Pages
- WhatsApp Ops
- WhatsApp Ops
- UI Components
- Shared Libs
- UI Components
- Box Ops
- UI Components
- Ops Agent
- React Hooks
- UI Components
- App Pages
- WhatsApp Frontend
- UI Components
- UI Components
- Package Devdependencies
- UI Components
- WhatsApp Ops
- WhatsApp Ops
- Shared Libs
- Box Ops
- WhatsApp Ops
- WhatsApp Ops
- WhatsApp Ops
- WhatsApp Ops
- Tsconfig App
- Shared Libs
- Shared Libs
- UI Components
- Edge Functions
- Components Aliases
- Box Ops
- Shared Libs
- UI Components
- WhatsApp Frontend
- WhatsApp Frontend
- WhatsApp Frontend
- WhatsApp Frontend
- App Pages
- Edge Functions
- Edge Functions
- Box Ops
- WhatsApp Frontend
- Edge Functions
- UI Components
- UI Components
- WhatsApp Ops
- WhatsApp Ops
- UI Components
- Edge Functions
- Edge Functions
- Tsconfig Node
- WhatsApp Ops
- WhatsApp Ops
- Package Scripts
- WhatsApp Frontend
- WhatsApp Ops
- UI Components
- UI Components
- UI Components
- App Pages
- UI Components
- Ops Scripts
- WhatsApp Ops
- WhatsApp Frontend
- Shared Libs
- Shared Libs
- Shared Libs
- Edge Functions
- Edge Functions
- Edge Functions
- Tsconfig Compileroptions
- UI Components
- UI Components
- Shared Libs
- Edge Functions
- WA Recon Docs
- Ops Agent
- Ops Scripts
- Public Manifest
- UI Components
- App Pages
- Edge Functions
- Edge Functions
- WA Recon Docs
- WA Recon Docs
- UI Components
- UI Components
- UI Components
- UI Components
- WA Recon Docs
- Box Ops
- UI Components
- UI Components
- UI Components
- UI Components
- UI Components
- UI Components
- App Pages
- Edge Functions
- Edge Functions
- Docs Backup
- WA Recon Docs
- Box Ops
- Ops Scripts
- UI Components
- UI Components
- UI Components
- App Pages
- App Pages
- Edge Functions
- Edge Functions
- Edge Functions
- Edge Functions
- Edge Functions
- Edge Functions
- Edge Functions
- WA Recon Docs
- WA Recon Docs
- Mcp Mcp
- Box Ops
- Box Ops
- WhatsApp Frontend
- WhatsApp Frontend
- WhatsApp Frontend
- Edge Functions
- Edge Functions
- Edge Functions
- Provider API Docs
- WA Recon Docs
- Edge Functions
- Edge Functions
- Edge Functions
- WA Recon Docs
- Box Ops
- Box Ops
- Ops Scripts
- Ops Scripts
- Ops Scripts
- UI Components
- Shared Libs
- Edge Functions
-  Github
- Provider API Docs
- Box Ops
- Ops Scripts
- Ops Scripts
- Ops Scripts
- UI Components
- UI Components
- Edge Functions
- Edge Functions
- Edge Functions
- Edge Functions
- Ops Scripts
- Ops Scripts
- Ops Scripts
- Ops Scripts
- Ops Scripts
- Ops Scripts
- Edge Functions
- Edge Functions
- Edge Functions
- Edge Functions
- Provider API Docs
- Box Ops
- Box Ops
- Ops Scripts
- Ops Scripts
- Ops Scripts
- Ops Scripts
- Ops Scripts
- WhatsApp Ops
- WhatsApp Frontend
- Edge Functions
- Edge Functions
- Claude Project
- Provider API Docs

## God Nodes (most connected - your core abstractions)
1. `cn()` - 499 edges
2. `useToast()` - 180 edges
3. `supabase` - 139 edges
4. `fetchAllRows()` - 102 edges
5. `useStatusCategories()` - 83 edges
6. `DialogContent` - 73 edges
7. `DialogTitle` - 71 edges
8. `DialogHeader()` - 70 edges
9. `Input` - 66 edges
10. `Button` - 63 edges

## Surprising Connections (you probably didn't know these)
- `Port Transform Recipe (build/test/confirm)` --semantically_similar_to--> `Box-Native Wave Migration Sequence`  [INFERRED] [semantically similar]
  src/whatsapp/PORT_PLAN.md → docs/wa-mancer-recon/11-whatsapp-schema-build-plan.md
- `useCarousel()` --references--> `react`  [EXTRACTED]
  src/components/ui/carousel.tsx → package.json
- `useChart()` --references--> `react`  [EXTRACTED]
  src/components/ui/chart.tsx → package.json
- `CourierDeliveryNoteWizard()` --references--> `react`  [EXTRACTED]
  src/components/delivery/CourierDeliveryNoteWizard.tsx → package.json
- `DeliveryNoteWizard()` --references--> `react`  [EXTRACTED]
  src/components/delivery/DeliveryNoteWizard.tsx → package.json

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **DigiCom Delivery Provider Adapters** — docs_providers_api_documentation_ameex_api_documentation_ameex, docs_providers_api_documentation_coliaty_api_documentation_coliaty, docs_providers_api_documentation_digylog_api_documentation_digylog, docs_providers_api_documentation_forcelog_api_documentation_forcelog, docs_providers_api_documentation_quicklivraison_api_documentation_quicklivraison, docs_providers_api_documentation_sendit_api_documentation_sendit, docs_providers_api_documentation_vitex_api_documentation_vitex, docs_providers_api_documentation_ozonexpress_api_ozonexpress [INFERRED 0.85]
- **Backup & Disaster Recovery System** — docs_backup_dashboard_spec_backup_dashboard, docs_dr_runbook_dr_runbook, ops_ops_backup_infra, ops_postgres_image_docker_compose_backup_pgbackrest_overlay [INFERRED 0.85]
- **WhatsApp Integration Fleet** — ops_box_whatsapp_edge_wa_edge, ops_box_whatsapp_schema_wa_schema, ops_whatsapp_node_wa_node [INFERRED 0.85]
- **WA Mancer Outbound Send Flow** — docs_wa_mancer_recon_07_worker_dispatcher_loop, docs_wa_mancer_recon_02_database_queue_claim_atomic, docs_wa_mancer_recon_02_database_pacing_token_bucket, docs_wa_mancer_recon_01_design_docs_worker_outbound_chokepoint [INFERRED 0.85]
- **Inbound Message & Conversation Resolution** — docs_wa_mancer_recon_07_worker_webhook_receiver, docs_wa_mancer_recon_13_conversation_resolution_live_ingest_message, docs_wa_mancer_recon_13_conversation_resolution_live_capture_jid_mapping, docs_wa_mancer_recon_13_conversation_resolution_live_consolidate_lid_conversation, ops_whatsapp_node_evolution_patches_002_preserve_lid_in_webhook_key_patch_002 [INFERRED 0.85]
- **WA Mancer to iGrowFast Merge Plan** — docs_wa_mancer_recon_10_integration_blueprint_whatsapp_schema_port, docs_wa_mancer_recon_11_whatsapp_schema_build_plan_schema_build_plan, docs_wa_mancer_recon_10_integration_blueprint_business_id_tenancy, docs_wa_mancer_recon_11_whatsapp_schema_build_plan_two_adaptation_layers, src_whatsapp_port_plan_port_plan [INFERRED 0.85]

## Communities (238 total, 48 thin omitted)

### Community 0 - "WhatsApp Media & Icons"
Cohesion: 0.02
Nodes (122): checkWhatsApp(), buildMediaUrl(), ResolvedMedia, useResolvedMediaUrl(), EMOJI_DATA, EMOJI_KEYWORDS, IconBackspace(), IconBan() (+114 more)

### Community 1 - "App Shell & Route Guards"
Cohesion: 0.03
Nodes (76): WhatsappAssignment, WhatsappContacts, WhatsappConversations, WhatsappNumberDetail, WhatsappNumbers, WhatsappSellerInbox, MediaBuyerIntegrationGuard(), buildDeliveryNoteReference() (+68 more)

### Community 2 - "Order Contact Actions"
Cohesion: 0.04
Nodes (89): ImageHoverPreview(), ImageHoverPreviewProps, OrderContactSubmenu(), OrderPhoneContactDropdown(), OrderPhoneContactDropdownProps, OrderPhoneQuickActions(), smsHref(), telHref() (+81 more)

### Community 3 - "Order Form & Provider Adapters"
Cohesion: 0.05
Nodes (83): AdminChatCartOrderDialog(), friendlyStockError(), orderCompanyIsAmeex(), orderCompanyIsColiaty(), orderCompanyIsDelvoExpress(), orderCompanyIsForcelog(), orderCompanyIsQuickLivraison(), orderCompanyIsSendit() (+75 more)

### Community 4 - "Dashboard Stat Rows"
Cohesion: 0.03
Nodes (87): SectionSkeleton(), ProductHeaderRow(), UnitCell(), SellerHeaderRow(), HeadlineStat(), TooltipRow(), FulfillerRow(), HeaderChip() (+79 more)

### Community 5 - "Business & Profile Modals"
Cohesion: 0.03
Nodes (78): react, AddEditBusinessModal(), AvatarEditDialog(), BankDetailsCard(), BankProfile, EditableBankField(), ProfileScaffold(), useFormField() (+70 more)

### Community 6 - "WhatsApp Quick Replies & Steps"
Cohesion: 0.04
Nodes (79): bizCache, businessIdOf(), decodeAudioDurationSeconds(), MediaStep, MediaStepType, MessageStep, QrMediaUploadResponse, QuickReply (+71 more)

### Community 7 - "Business Form & Form Primitives"
Cohesion: 0.04
Nodes (77): AddEditBusinessModalProps, BusinessFormValues, businessSchema, STATUS_CFG, ConfirmDialog(), FormControl, FormField(), FormFieldContext (+69 more)

### Community 8 - "WhatsApp Inbox Handlers"
Cohesion: 0.05
Nodes (82): activeOpenPeer, armSyncSettle(), backfillContactsFromEvolution(), backfillInFlight, broadcastPeerStoppedTyping(), buildGroupEventBody(), captureJidMapping(), deliveryRank() (+74 more)

### Community 9 - "Order Status Dialogs"
Cohesion: 0.05
Nodes (60): AccessoryPreviewDialogProps, AdminActions, HistoryRecord, OrderShape, OrderStatusHistoryDialog(), OrderStatusHistoryDialogProps, OrdStatus, DataListItem (+52 more)

### Community 10 - "WhatsApp Evolution Handlers"
Cohesion: 0.06
Nodes (74): activeOpenPeer, backfillContactsFromEvolution(), backfillInFlight, buildGroupEventBody(), captureJidMapping(), deliveryRank(), dropViewer(), ensurePeerPresenceSubscribed() (+66 more)

### Community 11 - "NPM Dependencies"
Cohesion: 0.03
Nodes (69): dependencies, arabic-reshaper, bidi-js, buffer, class-variance-authority, clsx, cmdk, cobe (+61 more)

### Community 12 - "App Pages"
Cohesion: 0.07
Nodes (55): AccessoryPreviewDialog(), formatAccessoryInventoryValueDh(), AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader() (+47 more)

### Community 13 - "WhatsApp Node Worker"
Cohesion: 0.07
Nodes (54): Config, attachListenClient(), channels, closeDb(), listenOn(), NotifyHandler, pool, quoteIdent() (+46 more)

### Community 14 - "App Pages"
Cohesion: 0.08
Nodes (56): MediaBuyersSection(), CustomerInsights(), CustomerInsightsProps, MonthData, OrderRecord, ConfirmationPipeline(), DashboardCityStats(), DashboardProductsPerformance() (+48 more)

### Community 15 - "Shared Libs & Utils"
Cohesion: 0.07
Nodes (54): input-otp, HoldToConfirmButton(), JOB_LOG, JobKind, JOBS, ManualBackupWizard(), STEPS, Mode (+46 more)

### Community 16 - "WhatsApp UI Components"
Cohesion: 0.08
Nodes (59): AdminCartOrderDraft, SellerCartOrderDraft, useSidebarCollapse(), sendMessage(), sendReadReceipt(), sendStepSequence(), MessageDecrypted, parseJid() (+51 more)

### Community 17 - "WhatsApp Inbox State"
Cohesion: 0.05
Nodes (46): cancelOutboundMessage(), deleteMessageForEveryone(), deleteMessageForMe(), deriveFileName(), editMessage(), forceDispatchNow(), forwardMessage(), ForwardResult (+38 more)

### Community 18 - "WhatsApp Conversations"
Cohesion: 0.07
Nodes (47): applyAutoAssignBacklog(), AssignmentRow, AutoAssignConfig, AutoAssignStrategy, bulkAssignConversations(), bulkUnassignConversations(), listInstanceAssignments(), listUnassignedConversations() (+39 more)

### Community 19 - "UI Components"
Cohesion: 0.11
Nodes (38): AdsOrderForMatching, AdsOrderItem, AdsSectionProps, CampaignRow, GlobalAdEntry, PLATFORM_COLORS, ProductAdRow, AnalyticsDateFilter() (+30 more)

### Community 20 - "App Pages"
Cohesion: 0.09
Nodes (44): useCampaignBasePath(), CampaignTotals, DailyMetrics, MediaBuyerProfile, OrderRow, RevenueBasis, useCampaignMetrics(), useCurrentUserId() (+36 more)

### Community 21 - "WhatsApp Ops"
Cohesion: 0.07
Nodes (53): BACKOFF_SECONDS, dispatch(), drivePresence(), fetchOutboundMessage(), getOwnerJid(), handleDispatchError(), inflightCount(), isMessageBackedAction() (+45 more)

### Community 22 - "WhatsApp Ops"
Cohesion: 0.07
Nodes (52): BACKOFF_SECONDS, dispatch(), drivePresence(), fetchOutboundMessage(), getOwnerJid(), handleDispatchError(), inflightCount(), isMessageBackedAction() (+44 more)

### Community 23 - "App Pages"
Cohesion: 0.08
Nodes (43): xlsx, OrderTrackingImport(), Props, Stat(), Progress, Table, TableBody, TableCaption (+35 more)

### Community 24 - "App Pages"
Cohesion: 0.07
Nodes (42): AppLayout(), AppLayoutProps, OrderStatusNotifications(), Props, Role, OrderStatusToastPayload, RenderArgs, showOrderStatusToast() (+34 more)

### Community 25 - "Shared Libs"
Cohesion: 0.12
Nodes (43): AdsSection(), getPlatformIcon(), BusinessHealthSection(), CouriersSection(), CustomersSection(), OrdersSection(), EXPENSE_COLORS, ProfitabilitySection() (+35 more)

### Community 26 - "UI Components"
Cohesion: 0.07
Nodes (40): adsOverlapFraction(), DashboardProductsPerformanceProps, DPAccessory, DPAd, DPOrder, DPOrderItem, DPProduct, DPSeller (+32 more)

### Community 27 - "App Pages"
Cohesion: 0.07
Nodes (40): ConnectionInsert, CORE_METRICS, DateRange, GAConnection, gaDb, resolveBusinessId(), useActiveBusinessId(), useAddGAConnection() (+32 more)

### Community 28 - "App Pages"
Cohesion: 0.08
Nodes (36): orderMatchesSellerProducts(), Separator, Skeleton(), TabsList, TabsTrigger, CourierParcelRow, OrderWithParcels, Parcel (+28 more)

### Community 29 - "App Pages"
Cohesion: 0.08
Nodes (38): Label, labelVariants, RadioGroup, RadioGroupItem, BonCommandeSupplierBlock, computeTotals(), roundMoney(), OrderDerivedClient (+30 more)

### Community 30 - "Shared Libs"
Cohesion: 0.09
Nodes (33): ConfigSectionProps, EmailAccountCard(), EmailAccountCardProps, EmailAccountModalProps, EmailAccountsSection(), QK, EmailTemplateCard(), EmailTemplateCardProps (+25 more)

### Community 31 - "UI Components"
Cohesion: 0.08
Nodes (35): EmailAccountModal(), FormValues, makeSchema(), SECURITY_OPTIONS, ServerRow(), uiSecurity(), EmailTemplateModal(), emptyForm() (+27 more)

### Community 32 - "Shared Libs"
Cohesion: 0.09
Nodes (37): buildCourierPayoutPdfBlob(), CourierPayoutDocument(), CourierPayoutPdfInput, CourierPayoutPdfLineItem, downloadCourierPayoutPdf(), fmtDate(), fmtMAD(), resolveCourierPayoutImages() (+29 more)

### Community 33 - "WhatsApp Ops"
Cohesion: 0.10
Nodes (32): Config, required(), requiredNumber(), attachListenClient(), channels, closeDb(), listenOn(), NotifyHandler (+24 more)

### Community 34 - "WhatsApp Ops"
Cohesion: 0.10
Nodes (38): applyState(), claimLeases(), deleteEvolutionInstance(), EvolutionInstanceRow, fetchAllEvolutionInstances(), fetchDisconnectReason(), fetchEvolutionState(), fetchToken() (+30 more)

### Community 35 - "WhatsApp Frontend"
Cohesion: 0.07
Nodes (34): Avatar(), AvatarSize, Props, px(), radius, AvatarConfig, CompositeTypes, Constants (+26 more)

### Community 36 - "WhatsApp Ops"
Cohesion: 0.11
Nodes (36): applyState(), claimLeases(), deleteEvolutionInstance(), EvolutionInstanceRow, fetchAllEvolutionInstances(), fetchDisconnectReason(), fetchEvolutionState(), fetchToken() (+28 more)

### Community 37 - "WhatsApp Frontend"
Cohesion: 0.09
Nodes (30): RFC-6868, EnsureConversationArgs, CC_1, CC_2, conversationLabel(), detectCountryCode(), formatPhone(), formatUnread() (+22 more)

### Community 38 - "React Hooks"
Cohesion: 0.10
Nodes (30): Entry, MBUser, MediaBuyerEarnings, monthBounds(), OrderRow, PaymentRow, useMediaBuyerEarnings(), CampaignPoint (+22 more)

### Community 39 - "App Pages"
Cohesion: 0.08
Nodes (32): Avatar, AvatarFallback, AvatarImage, requestCredentialChange(), EDITABLE_ROLES, firstConfigTab(), hasEditableConfig(), IntegrationAccessField() (+24 more)

### Community 40 - "WhatsApp Frontend"
Cohesion: 0.09
Nodes (26): deriveCountryCode(), DiffRow, ImportContactsModal(), ImportContactsModalProps, Phase, PhoneBookEntry, cache, extractFirstUrl() (+18 more)

### Community 41 - "WhatsApp Frontend"
Cohesion: 0.10
Nodes (19): waQueryClient, dismissToast(), DUR, emit(), genId(), listeners, mediaSizeError(), normalizeError() (+11 more)

### Community 43 - "Shared Libs"
Cohesion: 0.11
Nodes (32): EmailPromptDialog(), expiryLabel(), InvitationsPanel(), phaseOf(), InviteUserWizard(), RoleMeta, ROLES, checkInvitation() (+24 more)

### Community 44 - "WhatsApp Frontend"
Cohesion: 0.10
Nodes (30): queryClient, markConversationRead(), togglePin(), ConversationDecrypted, ConversationStatus, useConversationAssignees(), useConversationAssigneesRealtime(), applyBump() (+22 more)

### Community 45 - "Shared Libs"
Cohesion: 0.14
Nodes (24): CourierLayout(), CourierLayoutProps, NotificationPermissionDialog(), Props, CourierNotificationRow, useCourierNotifications(), UseCourierNotificationsOpts, arrayBufferToBase64() (+16 more)

### Community 46 - "App Pages"
Cohesion: 0.12
Nodes (29): fkColumn(), PaymentHistoryDialog(), queryInvalidationKeys(), RecordPaymentDialog(), txnTable(), useSellerLedger(), DailyEarning, deriveStatus() (+21 more)

### Community 47 - "WhatsApp Ops"
Cohesion: 0.07
Nodes (28): ContactCard, DeleteMessageInput, EvolutionClientOptions, EvolutionError, GetBase64FromMediaMessageInput, GetBase64FromMediaMessageResponse, MarkReadInput, MediaType (+20 more)

### Community 48 - "WhatsApp Ops"
Cohesion: 0.07
Nodes (28): ContactCard, DeleteMessageInput, EvolutionClientOptions, EvolutionError, GetBase64FromMediaMessageInput, GetBase64FromMediaMessageResponse, MarkReadInput, MediaType (+20 more)

### Community 49 - "UI Components"
Cohesion: 0.10
Nodes (24): AccessoryPreviewRow, AdminActions, formatProductDhAggregate(), PricePair(), productInventoryTotals(), ProductPreviewDialog(), ProductPreviewDialogProps, ProductPreviewRow (+16 more)

### Community 50 - "Shared Libs"
Cohesion: 0.14
Nodes (28): buildCourierPayoutPdfBase64(), buildCourierReturnPdfBase64(), arrayBufferToBase64(), blobToBase64(), buildMediaBuyerPayoutPdfBase64(), attributePaymentOrders(), buildSellerPayoutPdfBase64(), buildSellerPayoutPdfBlob() (+20 more)

### Community 51 - "UI Components"
Cohesion: 0.10
Nodes (22): DateFilter, BusinessHealthSectionProps, CouriersSectionProps, CustomersSectionProps, InventorySectionProps, OrdersSectionProps, ProfitabilitySectionProps, SalesChannelsSectionProps (+14 more)

### Community 52 - "Box Ops"
Cohesion: 0.12
Nodes (25): call(), checkWhatsApp(), connectInstance(), connectionState(), createGroup(), createInstance(), CreateInstanceInput, DEFAULT_EVENTS (+17 more)

### Community 53 - "UI Components"
Cohesion: 0.07
Nodes (27): Sidebar, SidebarContent, SidebarContext, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel (+19 more)

### Community 54 - "Ops Agent"
Cohesion: 0.14
Nodes (17): BaseHTTPRequestHandler, audit(), b64url_decode(), Handler, is_backup_admin(), _jwk_to_pem(), _load_jwks(), presign_get() (+9 more)

### Community 55 - "React Hooks"
Cohesion: 0.10
Nodes (15): CreateCampaignWizard(), metaDb, useMetaUpdateBudget(), useMetaUploadImageFromUrl(), useVerifyMetaToken(), InvokeBody, invokeMeta(), MetaAd (+7 more)

### Community 56 - "UI Components"
Cohesion: 0.13
Nodes (20): AdSetData, AUDIENCE_NETWORK_POSITIONS, BID_STRATEGIES, BILLING_EVENTS, CampaignData, CONVERSION_LOCATIONS, FACEBOOK_POSITIONS, INSTAGRAM_POSITIONS (+12 more)

### Community 57 - "App Pages"
Cohesion: 0.09
Nodes (24): BonLivraisonSnapshot, BonLivraisonSource, CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums (+16 more)

### Community 58 - "WhatsApp Frontend"
Cohesion: 0.12
Nodes (24): ConversationTag, Tag, tagKeys, useAssignTag(), useCreateTag(), useDeleteTag(), useUnassignTag(), useUpdateTag() (+16 more)

### Community 59 - "UI Components"
Cohesion: 0.10
Nodes (22): getStatus(), Status, statusConfig, timeAgo(), WebhookHealthIndicator(), Device, DEVICES, EmailPreview() (+14 more)

### Community 60 - "UI Components"
Cohesion: 0.09
Nodes (24): AvatarStudio(), AvatarStudioProps, AvatarValue, Cfg, EARS, EYEBROWS, EYES, fileToSquarePng() (+16 more)

### Community 61 - "Package Devdependencies"
Cohesion: 0.08
Nodes (25): devDependencies, autoprefixer, cross-env, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, eslint-plugin-unused-imports (+17 more)

### Community 62 - "UI Components"
Cohesion: 0.08
Nodes (21): Carousel, CarouselApi, CarouselContent, CarouselContext, CarouselContextProps, CarouselItem, CarouselNext, CarouselOptions (+13 more)

### Community 63 - "WhatsApp Ops"
Cohesion: 0.13
Nodes (22): Claimed, claimNextJob(), decodeMediaKey(), downloadWhatsAppMedia(), failJob(), getInstanceCreds(), isCdnExpiry(), MEDIA_CONCURRENCY (+14 more)

### Community 64 - "WhatsApp Ops"
Cohesion: 0.13
Nodes (22): Claimed, claimNextJob(), decodeMediaKey(), downloadWhatsAppMedia(), failJob(), getInstanceCreds(), isCdnExpiry(), MEDIA_CONCURRENCY (+14 more)

### Community 65 - "Shared Libs"
Cohesion: 0.15
Nodes (19): BonLivraisonTransportSnapshot, DevisBusinessBlock, DevisBusinessSource, DevisClientBlock, DevisLine, DevisLinesSource, DevisStampSource, FactureBusinessBlock (+11 more)

### Community 66 - "Box Ops"
Cohesion: 0.23
Nodes (10): ACTIONS, PresenceState, CANONICAL_EVENTS, WORKER_WEBHOOK_URL_BASE, CORS, json(), preflight(), InstanceCtx (+2 more)

### Community 67 - "WhatsApp Ops"
Cohesion: 0.09
Nodes (22): dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, pg, @supabase/supabase-js, description, devDependencies, tsx (+14 more)

### Community 68 - "WhatsApp Ops"
Cohesion: 0.09
Nodes (22): compilerOptions, declaration, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib, module (+14 more)

### Community 69 - "WhatsApp Ops"
Cohesion: 0.09
Nodes (22): dependencies, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, pg, @supabase/supabase-js, description, devDependencies, tsx (+14 more)

### Community 70 - "WhatsApp Ops"
Cohesion: 0.09
Nodes (22): compilerOptions, declaration, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib, module (+14 more)

### Community 71 - "Tsconfig App"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, jsx, lib, module, moduleDetection (+14 more)

### Community 72 - "Shared Libs"
Cohesion: 0.15
Nodes (21): qrcode, baseStyles(), buildQrDataUrl(), BusinessRow, CourierParcelRow, CourierPrintFormat, CourierRow, escapeHtml() (+13 more)

### Community 73 - "Shared Libs"
Cohesion: 0.21
Nodes (19): CredentialChangeDialog(), SecuritySection(), TotpEnrollDialog(), confirmSelfChange(), deleteOwnPasskey(), describePasskeyError(), enrollTotp(), invokeJson() (+11 more)

### Community 74 - "UI Components"
Cohesion: 0.16
Nodes (19): fmt(), GlobalLedgerDialog(), MonthOrder, MonthRow(), orderStateMeta, periodName(), SellerBreakdownDialog(), SellerTicketDetailDialog() (+11 more)

### Community 76 - "Components Aliases"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, registries (+11 more)

### Community 77 - "Box Ops"
Cohesion: 0.15
Nodes (15): RFC-1918, assertResolvedHostSafe(), decodeEntities(), escape(), extractCanonical(), extractTagText(), isBlockedIp(), isBlockedIpv4() (+7 more)

### Community 78 - "Shared Libs"
Cohesion: 0.20
Nodes (16): PasswordStrengthBar(), SEG_COLOR, checkCredentialToken(), confirmCredentialChange(), credReason(), CredResult, CredTokenStatus, invokeJson() (+8 more)

### Community 79 - "UI Components"
Cohesion: 0.14
Nodes (18): Toast, ToastAction, ToastActionElement, ToastClose, ToastDescription, ToastKicker(), ToastProps, ToastTitle (+10 more)

### Community 80 - "WhatsApp Frontend"
Cohesion: 0.14
Nodes (19): CreateInstanceDialog(), createInstance(), disconnectInstance(), listInstances(), pairInstance(), pushWaProfile(), restartInstance(), WaProfileField (+11 more)

### Community 81 - "WhatsApp Frontend"
Cohesion: 0.12
Nodes (14): formatElapsed(), PairDialog(), Phase, Props, Spinner(), SyncingBody(), SyncStage, Tile() (+6 more)

### Community 82 - "WhatsApp Frontend"
Cohesion: 0.14
Nodes (19): call(), CheckWhatsAppEntry, CheckWhatsAppResp, createGroup(), CreateGroupResp, CreateInstanceResp, fetchStatus(), GroupParticipantsResp (+11 more)

### Community 83 - "WhatsApp Frontend"
Cohesion: 0.13
Nodes (16): pushWaSettings(), usePushWaSettings(), useSetInstanceSettings(), ACCENT_DOT, Card(), HumanizationCard(), OperationalCard(), PacingCard() (+8 more)

### Community 84 - "App Pages"
Cohesion: 0.11
Nodes (17): ORDER_CAT_PRED, orderPred(), OrderStatus, PackageStatus, PKG_CAT_PRED, pkgPred(), Courier, CourierFeeRow (+9 more)

### Community 85 - "Edge Functions"
Cohesion: 0.20
Nodes (18): appendQuery(), b64url(), b64urlDecode(), CORS_HEADERS, exchangeCodeForToken(), getAppSecret(), getStateSecret(), GraphError (+10 more)

### Community 87 - "Box Ops"
Cohesion: 0.23
Nodes (13): aws, MIME_TO_EXT, anon, asCaller(), requireAdmin(), requireUser(), logError(), capPayload() (+5 more)

### Community 88 - "WhatsApp Frontend"
Cohesion: 0.14
Nodes (15): ACCENTS, InstanceAvatar(), Props, InstanceCard(), Props, STATUS_STRIPE, DOT, LABEL (+7 more)

### Community 90 - "UI Components"
Cohesion: 0.15
Nodes (11): ACTIVE_ANNOUNCEMENT, AppAnnouncement, AnnouncementGate(), AnnouncementModal(), AnnouncementModalProps, AuthBackground(), BackgroundMode, detectMode() (+3 more)

### Community 91 - "UI Components"
Cohesion: 0.37
Nodes (15): AdSetsTable(), AdsTable(), AdSetSubRows(), AdSubRows(), BudgetCell(), CampaignRow(), SummaryBar(), Totals (+7 more)

### Community 94 - "UI Components"
Cohesion: 0.15
Nodes (13): ColumnCustomizer(), Props, ManagerToolbar(), PRESETS, Props, COLUMN_PRESETS, ColumnDef, DeliveryStatus (+5 more)

### Community 95 - "Edge Functions"
Cohesion: 0.14
Nodes (8): CORS_HEADERS, DatePreset, GraphError, graphGet(), graphPost(), INSIGHT_FIELDS, mapGraphError(), TOKEN_CACHE

### Community 97 - "Tsconfig Node"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection, moduleResolution, noEmit (+7 more)

### Community 98 - "WhatsApp Ops"
Cohesion: 0.23
Nodes (13): handleEvent(), handleQrCodeUpdated(), handlePost(), readBody(), reply(), startWebhookServer(), uuidish(), cache (+5 more)

### Community 99 - "WhatsApp Ops"
Cohesion: 0.26
Nodes (13): avatarKey(), cacheAvatar(), isCachedAvatar(), isWhatsAppCdn(), mediaExists(), backfillInstance(), Candidate, InstanceRow (+5 more)

### Community 100 - "Package Scripts"
Cohesion: 0.13
Nodes (14): name, private, scripts, build, build:dev, dev, dev:dev, dev:prod (+6 more)

### Community 101 - "WhatsApp Frontend"
Cohesion: 0.15
Nodes (9): DeleteInstanceModal(), Phase, ROWS, RowSpec, deleteInstance(), instanceDeletePreflight, InstanceDeleteSummary, useDeleteInstance() (+1 more)

### Community 102 - "WhatsApp Ops"
Cohesion: 0.27
Nodes (12): avatarKey(), cacheAvatar(), isCachedAvatar(), isWhatsAppCdn(), mediaExists(), backfillInstance(), Candidate, InstanceRow (+4 more)

### Community 103 - "UI Components"
Cohesion: 0.19
Nodes (10): CaptchaGate, CaptchaGateHandle, Window, ensureStyles(), EyePasswordToggle(), EyePasswordToggleProps, requestPasswordReset(), LoginFormValues (+2 more)

### Community 104 - "UI Components"
Cohesion: 0.27
Nodes (9): BulkActions(), Props, Props, StatusToggle(), nfc, Checkbox, useMetaAllAds(), useMetaAllAdSets() (+1 more)

### Community 105 - "UI Components"
Cohesion: 0.23
Nodes (12): Props, Props, Props, Props, PixelDashboard(), Props, nf, DatePreset (+4 more)

### Community 106 - "App Pages"
Cohesion: 0.23
Nodes (10): MetaAdsManager(), useDeleteMetaConnection(), useMetaAccountSummary(), useMetaConnections(), useSetDefaultMetaConnection(), useStartMetaOAuth(), ConnectionSwitcher(), MetaAdsPage() (+2 more)

### Community 107 - "UI Components"
Cohesion: 0.18
Nodes (10): AccordionSection(), Props, AD_FORMATS, FieldHelper(), FieldLabel(), Props, AdStep(), FORMAT_ICONS (+2 more)

### Community 108 - "Ops Scripts"
Cohesion: 0.19
Nodes (12): fail(), MAP, RCLONE_CONFIG, RCLONE_CONFIG_R2CFG_ACCESS_KEY_ID, RCLONE_CONFIG_R2CFG_ENDPOINT, RCLONE_CONFIG_R2CFG_NO_CHECK_BUCKET, RCLONE_CONFIG_R2CFG_PROVIDER, RCLONE_CONFIG_R2CFG_REGION (+4 more)

### Community 109 - "WhatsApp Ops"
Cohesion: 0.27
Nodes (11): handlePost(), readBody(), reply(), startWebhookServer(), uuidish(), cache, CachedSecret, constantTimeEqual() (+3 more)

### Community 110 - "WhatsApp Frontend"
Cohesion: 0.27
Nodes (12): jszip, uploadDocPreview(), canvasToJpeg(), generateDocThumbnail(), isOoxml(), isThumbnailable(), ooxmlThumbnail(), pdfThumbnail() (+4 more)

### Community 111 - "Shared Libs"
Cohesion: 0.32
Nodes (12): CityRow, hydrateBonLivraisonFromAnyNote(), hydrateBonLivraisonFromCompanyNote(), hydrateBonLivraisonFromCourierNote(), hydrateBonLivraisonFromOrder(), masterLabel(), mergeLine(), mergeOrderItemsIntoMap() (+4 more)

### Community 112 - "Shared Libs"
Cohesion: 0.22
Nodes (12): buildMediaBuyerPayoutPdfBlob(), embed(), fmtDate(), fmtDateTime(), fmtMAD(), MediaBuyerPayoutDailyRow, MediaBuyerPayoutDocument(), MediaBuyerPayoutPdfInput (+4 more)

### Community 113 - "Shared Libs"
Cohesion: 0.23
Nodes (11): TrackableCompanyParcelRow, BatchSyncResult, getPackageStatuses(), matchPackageStatus(), norm(), OrderForSync, PackageStatusRow, pickStatusFromResponse() (+3 more)

### Community 114 - "Edge Functions"
Cohesion: 0.21
Nodes (9): ALLOWED_TARGET_ROLES, corsHeaders, DISPOSABLE, DNS_TYPE, dohHas(), json(), TYPO_FIX, verifaliaClassify() (+1 more)

### Community 116 - "Edge Functions"
Cohesion: 0.21
Nodes (8): corsHeaders, DISPOSABLE, DNS_TYPE, dohHas(), json(), TYPO_FIX, verifaliaClassify(), verifyDeliverable()

### Community 117 - "Tsconfig Compileroptions"
Cohesion: 0.15
Nodes (12): compilerOptions, allowJs, baseUrl, noImplicitAny, noUnusedLocals, noUnusedParameters, paths, skipLibCheck (+4 more)

### Community 118 - "UI Components"
Cohesion: 0.30
Nodes (11): fmt(), MBPayoutLite, MBTxn, MediaBuyerBreakdownDialog(), MediaBuyerGlobalDialog(), MediaBuyerLedger, MediaBuyerPayoutDetailDialog(), MonthRow() (+3 more)

### Community 119 - "UI Components"
Cohesion: 0.17
Nodes (11): Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator, MenubarShortcut() (+3 more)

### Community 120 - "Shared Libs"
Cohesion: 0.33
Nodes (8): embedRemoteImagesForPdf(), BonCommandeSnapshot, embedRemoteImagesForPdf(), embedRemoteImagesForPdf(), arrayBufferToBase64(), embedRemoteImagesForPdfDoc(), fetchUrlAsDataUri(), SnapshotWithPdfImages

### Community 121 - "Edge Functions"
Cohesion: 0.17
Nodes (4): corsHeaders, DASH_PATH, PAYLOAD_STRIP, ROLE_FR

### Community 122 - "WA Recon Docs"
Cohesion: 0.18
Nodes (11): Composer Features, Inbox / Conversations UI, Scrolling Without Virtualization, Presence / Typing (three systems), Inbox Realtime Subscriptions, Box-Native Wave Migration Sequence, ant-* Tailwind Tokens (static, no theme-flip), IGF Design System Re-skin Guide (+3 more)

### Community 123 - "Ops Agent"
Cohesion: 0.38
Nodes (10): check_admin(), heartbeats(), main(), Write the restore request and start the fixed unit. The execute script     itsel, Read all heartbeat JSONs this box can see (own via r2db, toolbox via r2wd)., rclone_env(), restore_plan(), restore_start() (+2 more)

### Community 124 - "Ops Scripts"
Cohesion: 0.42
Nodes (9): alert(), cleanup_stage(), fail(), parity(), q(), RCLONE_CONFIG, rollback(), say() (+1 more)

### Community 125 - "Public Manifest"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 126 - "UI Components"
Cohesion: 0.20
Nodes (9): Props, Step, STEPS, DEFAULT_AD, DEFAULT_ADSET, DEFAULT_CAMPAIGN, CampaignStep(), ScrollArea (+1 more)

### Community 127 - "App Pages"
Cohesion: 0.18
Nodes (5): CalculatorInputs, ChartTooltipPayload, defaultInputs, STAT_TONE, StatBoxTone

### Community 130 - "WA Recon Docs"
Cohesion: 0.20
Nodes (10): WA Mancer Database (Territory), Database Merge Hazards (iGrowFast port), Atomic Queue Claim (no SKIP LOCKED), Telemetry/Cache Tables (97% of DB), Vault-Read Encryption Boundary, Security Fixes During Port (don't copy holes), Wave 0.5 Amputation (whatsapp_020), Audit-Log Append-Only Law (+2 more)

### Community 131 - "WA Recon Docs"
Cohesion: 0.22
Nodes (10): WA Mancer Admin UI, Assignment Routing Model (merge redesign target), NumberDetail Config Page, business_id Multi-Tenancy Seam, Scaling & Fleet Architecture (node_id sharding), Integration Blueprint (merge into iGrowFast), whatsapp Schema Database Port, Keep Telemetry, Prune Later (+2 more)

### Community 132 - "UI Components"
Cohesion: 0.24
Nodes (9): baseNavigation, GA_NAV, isParentPath(), isSectionActive(), MediaBuyerSidebar(), META_NAV, NavItem, NavSection (+1 more)

### Community 133 - "UI Components"
Cohesion: 0.24
Nodes (5): AdPreviewPanel(), MediaPreview(), Props, AdData, CTA_OPTIONS

### Community 134 - "UI Components"
Cohesion: 0.24
Nodes (9): createLiquidEffect(), createTouchTexture(), PixelBlast(), PixelBlastProps, PixelBlastVariant, ReinitConfig, SHAPE_MAP, TouchPoint (+1 more)

### Community 135 - "UI Components"
Cohesion: 0.20
Nodes (9): ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuShortcut(), ContextMenuSubContent (+1 more)

### Community 136 - "WA Recon Docs"
Cohesion: 0.22
Nodes (9): WA Mancer Edge Functions, instance-* Edge Functions, Invitation Edge Functions (verify_jwt=false), media-sign / media-upload Functions, Edge Function _shared Helpers, App Shell, Auth, Onboarding, User Inbox, Invitation Onboarding Flow, Admin/User Role Model (+1 more)

### Community 137 - "Box Ops"
Cohesion: 0.44
Nodes (6): admin, appendOwnGroupEvent(), buildSelfBody(), GroupEvent, onlyDigits(), resolveNames()

### Community 138 - "UI Components"
Cohesion: 0.22
Nodes (8): AccessoryRow, EntryRow, MBOrderItem, MBOrderRow, MBRow, MediaBuyersSectionProps, ProductRow, SellerRow

### Community 139 - "UI Components"
Cohesion: 0.22
Nodes (6): Granularity, GranularityChoice, SalesComparatifChartProps, SalesTooltipPayload, SalesTooltipRow, SCCOrder

### Community 140 - "UI Components"
Cohesion: 0.36
Nodes (8): ALL_NAV_PATHS, findActiveSection(), isParentPath(), isSectionActive(), navigation, NavItem, NavSection, Sidebar()

### Community 141 - "UI Components"
Cohesion: 0.31
Nodes (7): CampaignsTable(), ManagerTab, ManagerTabs(), Props, TABS, useMetaAccountTimeseries(), useMetaCampaigns()

### Community 142 - "UI Components"
Cohesion: 0.28
Nodes (6): ANT, buildDailySeries(), BusinessRow, fetchOwnerPlatformData(), OwnerPlatformDashboard(), PaymentRow

### Community 143 - "UI Components"
Cohesion: 0.22
Nodes (8): SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay, SheetTitle, sheetVariants

### Community 144 - "App Pages"
Cohesion: 0.33
Nodes (8): BonCommandeDirection, BonCommandePdfDocument(), buildFooterLines(), docTitle(), fmtDate(), fmtMoney(), Props, styles

### Community 146 - "Edge Functions"
Cohesion: 0.39
Nodes (8): colLetter(), CORS, googleToken(), json(), readSheet(), saClient, saJson(), syncChannel()

### Community 147 - "Docs Backup"
Cohesion: 0.32
Nodes (8): Owner Backups Dashboard Spec, drill_fresh Restore Gate, POST /api/restore Contract, Disaster Recovery Runbook, DR Escrow Card Root of Trust, igf-restore-drill Isolated Clone, ops/ Backup & DR Infrastructure, pgBackRest DB Image Overlay

### Community 148 - "WA Recon Docs"
Cohesion: 0.25
Nodes (8): Contact Truth Build Spec, WA Mancer Design Documentation Recon, Evolution Wrapped Not Exposed Invariant, 44 Per-Instance Settings and Lifecycle, Supabase Single Source of Truth Invariant, WA Mancer System Overview, Worker Outbound Chokepoint Invariant, Dispatcher Loop

### Community 149 - "Box Ops"
Cohesion: 0.32
Nodes (4): WORKER_WEBHOOK_URL_BASE, ENV_FALLBACK, randomToken(), slugify()

### Community 150 - "Ops Scripts"
Cohesion: 0.61
Nodes (6): fail(), parity(), q(), say(), igf-restore-drill.sh script, teardown()

### Community 151 - "UI Components"
Cohesion: 0.32
Nodes (5): formatCountdown(), SyncTrackingStatus(), SyncTrackingStatusProps, TrackingSyncRun, TrackingSyncState

### Community 152 - "UI Components"
Cohesion: 0.25
Nodes (6): DrawerContent, DrawerDescription, DrawerFooter(), DrawerHeader(), DrawerOverlay, DrawerTitle

### Community 153 - "UI Components"
Cohesion: 0.25
Nodes (7): NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuViewport

### Community 154 - "App Pages"
Cohesion: 0.36
Nodes (7): DevisSnapshot, buildFooterLines(), DevisPdfDocument(), fmtDate(), fmtMoney(), Props, styles

### Community 155 - "App Pages"
Cohesion: 0.36
Nodes (7): CampaignRow, KPI_ACCENTS, MediaBuyers(), paymentPill(), paymentTier(), PayoutRow, rateLabel()

### Community 156 - "Edge Functions"
Cohesion: 0.29
Nodes (3): CORS_HEADERS, getAccessToken(), getSaSigningKey()

### Community 157 - "Edge Functions"
Cohesion: 0.32
Nodes (6): isValidHybridJWT(), isValidJWT(), isValidLegacyJWT(), JWT_SECRET, PUBLIC_FUNCTIONS, SUPABASE_URL

### Community 162 - "Edge Functions"
Cohesion: 0.32
Nodes (6): DISPOSABLE, DNS_TYPE, dohHas(), TYPO_FIX, verifaliaClassify(), verifyDeliverable()

### Community 163 - "Edge Functions"
Cohesion: 0.33
Nodes (4): RFC-2047, corsHeaders, escHtml(), renderHtml()

### Community 164 - "WA Recon Docs"
Cohesion: 0.29
Nodes (7): Pacing Token Bucket with Debt, Worker Leases (Fencing), Instance Manager & Leases, Media Variation (anti-ban mangling), WA Mancer Node Worker, Pacing / Humanization (worker-side), Self-Presence Ban-Safety Timer

### Community 165 - "WA Recon Docs"
Cohesion: 0.29
Nodes (7): Caddy TLS Reverse Proxy, Infrastructure, Deployment & Secrets, Host systemd Log/Metrics Shippers, sops + age Secrets Topology, Evolution's Separate Postgres, The Live VPS (production box), Merge-Target Boxes (igf-whatsapp, igf-tools)

### Community 166 - "Mcp Mcp"
Cohesion: 0.43
Nodes (6): SUPABASE_ACCESS_TOKEN, npx, supabase-igrowfast-dev, supabase-igrowfast-prod, supabase-whatsappmancer, @supabase/mcp-server-supabase

### Community 167 - "Box Ops"
Cohesion: 0.38
Nodes (6): decodeXml(), escapeXml(), PreflightResult, r2, r2DeleteBatch(), r2ListPrefix()

### Community 168 - "Box Ops"
Cohesion: 0.29
Nodes (4): ALL, Field, PickedPicture, r2

### Community 169 - "WhatsApp Frontend"
Cohesion: 0.33
Nodes (5): dotStyle(), Props, typingBubbleTailStyle, typingBubbleWrapStyle, TypingIndicator()

### Community 170 - "WhatsApp Frontend"
Cohesion: 0.38
Nodes (5): NumbersEmptyState(), Props, InstanceCardSkeleton(), useInstancesRealtime(), AdminNumbers()

### Community 171 - "WhatsApp Frontend"
Cohesion: 0.33
Nodes (6): LABEL, Props, STATUS_DOT, STATUS_PILL, StatusPill(), InstanceStatus

### Community 175 - "Provider API Docs"
Cohesion: 0.40
Nodes (6): Forcelog Provider API, Forcelog Native Push Webhook, OzonExpress Provider API, status-categories.ts Magic-String Contract, Status Centralization Remediation Index, F3 Category-String Retirement Runbook

### Community 176 - "WA Recon Docs"
Cohesion: 0.40
Nodes (6): Identity Resolution (lid/phone/jid), Docker Compose Service Topology, captureJidMapping (lid↔phone learning), Evolution Patch 001 — No Reload on Profile Picture, Evolution Patch 002 — Preserve @lid in Webhook Key, WhatsApp Node Docker Compose Stack

### Community 177 - "Edge Functions"
Cohesion: 0.40
Nodes (3): corsHeaders, geo(), json()

### Community 179 - "Edge Functions"
Cohesion: 0.33
Nodes (5): corsHeaders, CourierNotificationRow, PushSubRow, supabase, WebhookPayload

### Community 180 - "WA Recon Docs"
Cohesion: 0.40
Nodes (5): Webhook Ingestion Is Not An Edge Function, Worker Webhook Receiver, consolidate_lid_conversation (SOFT consolidator), Live Conversation Resolution, ingest_message Inbound Pipeline

### Community 181 - "Box Ops"
Cohesion: 0.50
Nodes (4): escapeXml(), PreflightResult, r2, r2DeleteBatch()

### Community 182 - "Box Ops"
Cohesion: 0.50
Nodes (4): bail(), cleanup(), timer, ws

### Community 183 - "Ops Scripts"
Cohesion: 0.70
Nodes (4): fail(), RCLONE_CONFIG, say(), igf-db-pull.sh script

### Community 184 - "Ops Scripts"
Cohesion: 0.50
Nodes (3): fail(), RCLONE_CONFIG, igf-pgdump.sh script

### Community 185 - "Ops Scripts"
Cohesion: 0.70
Nodes (4): fail(), RCLONE_CONFIG, say(), igf-storage-mirror.sh script

### Community 186 - "UI Components"
Cohesion: 0.40
Nodes (4): Alert, AlertDescription, AlertTitle, alertVariants

### Community 187 - "Shared Libs"
Cohesion: 0.70
Nodes (4): addLocalizedName(), addStrings(), OrderForSearch, orderMatchesTopSearch()

### Community 189 - " Github"
Cohesion: 0.50
Nodes (4): Capistrano Atomic Symlink Flip, Frontend Deploy Workflow, tsc -b Typecheck Gate, iGrowFast Landing index.html

### Community 190 - "Provider API Docs"
Cohesion: 0.50
Nodes (4): AMEEX Provider API, Dashboard-Session Reverse Engineering Pattern, Quick Livraison Provider API, VITEX Provider API

### Community 191 - "Box Ops"
Cohesion: 0.67
Nodes (4): WhatsApp Edge Functions Port (box .102), whatsapp Schema Build, Evolution API Tailnet-Private Stack, WhatsApp Node 1 Deployment (box .67)

### Community 192 - "Ops Scripts"
Cohesion: 0.83
Nodes (3): fail(), run_backup(), igf-restic-backup.sh script

### Community 194 - "Ops Scripts"
Cohesion: 0.67
Nodes (3): fail(), RCLONE_CONFIG, igf-toolbox-dbdump.sh script

### Community 195 - "UI Components"
Cohesion: 0.50
Nodes (3): sonner, Toaster(), ToasterProps

### Community 196 - "UI Components"
Cohesion: 0.50
Nodes (3): AccordionContent, AccordionItem, AccordionTrigger

## Knowledge Gaps
- **1506 isolated node(s):** `supabase-whatsappmancer`, `$schema`, `style`, `rsc`, `tsx` (+1501 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **48 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Dashboard Stat Rows` to `App Shell & Route Guards`, `Order Contact Actions`, `Order Form & Provider Adapters`, `UI Components`, `Business & Profile Modals`, `UI Components`, `Business Form & Form Primitives`, `UI Components`, `Order Status Dialogs`, `UI Components`, `App Pages`, `UI Components`, `App Pages`, `UI Components`, `Shared Libs & Utils`, `UI Components`, `UI Components`, `UI Components`, `App Pages`, `App Pages`, `App Pages`, `Shared Libs`, `UI Components`, `UI Components`, `UI Components`, `App Pages`, `Shared Libs`, `UI Components`, `UI Components`, `App Pages`, `App Pages`, `App Pages`, `Shared Libs`, `React Hooks`, `App Pages`, `Shared Libs`, `WhatsApp Frontend`, `Shared Libs`, `App Pages`, `UI Components`, `UI Components`, `UI Components`, `React Hooks`, `UI Components`, `UI Components`, `UI Components`, `UI Components`, `UI Components`, `UI Components`, `Shared Libs`, `UI Components`, `UI Components`, `WhatsApp Frontend`, `WhatsApp Frontend`, `WhatsApp Frontend`, `App Pages`, `WhatsApp Frontend`, `UI Components`, `UI Components`, `UI Components`, `App Pages`, `UI Components`, `UI Components`, `UI Components`, `UI Components`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **Why does `supabase` connect `App Shell & Route Guards` to `Order Contact Actions`, `Order Form & Provider Adapters`, `Dashboard Stat Rows`, `UI Components`, `Business & Profile Modals`, `Business Form & Form Primitives`, `Order Status Dialogs`, `UI Components`, `UI Components`, `App Pages`, `UI Components`, `Shared Libs & Utils`, `App Pages`, `UI Components`, `App Pages`, `UI Components`, `App Pages`, `Shared Libs`, `UI Components`, `App Pages`, `App Pages`, `App Pages`, `Shared Libs`, `App Pages`, `UI Components`, `Shared Libs`, `React Hooks`, `App Pages`, `WhatsApp Frontend`, `Shared Libs`, `Shared Libs`, `App Pages`, `UI Components`, `Shared Libs`, `UI Components`, `React Hooks`, `App Pages`, `UI Components`, `Shared Libs`, `Shared Libs`, `UI Components`, `Shared Libs`, `App Pages`, `UI Components`, `UI Components`, `App Pages`, `Shared Libs`, `UI Components`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `useToast()` connect `Business & Profile Modals` to `App Shell & Route Guards`, `Order Contact Actions`, `Order Form & Provider Adapters`, `Dashboard Stat Rows`, `Business Form & Form Primitives`, `Order Status Dialogs`, `App Pages`, `App Pages`, `Shared Libs & Utils`, `App Pages`, `App Pages`, `App Pages`, `App Pages`, `App Pages`, `App Pages`, `Shared Libs`, `UI Components`, `Shared Libs`, `App Pages`, `Shared Libs`, `Shared Libs`, `App Pages`, `UI Components`, `React Hooks`, `App Pages`, `Shared Libs`, `UI Components`, `UI Components`, `UI Components`, `UI Components`, `App Pages`, `UI Components`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `supabase-whatsappmancer`, `$schema`, `style` to the rest of the system?**
  _1525 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `WhatsApp Media & Icons` be split into smaller, more focused modules?**
  _Cohesion score 0.016623376623376623 - nodes in this community are weakly interconnected._
- **Should `App Shell & Route Guards` be split into smaller, more focused modules?**
  _Cohesion score 0.03194103194103194 - nodes in this community are weakly interconnected._
- **Should `Order Contact Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.03932287074590019 - nodes in this community are weakly interconnected._