-- ============================================
-- SLOMS Test Data Seed
-- Run against a running database to reset it to a known state.
--
-- Produces a realistic-but-small dataset:
--   * A full price list (1 active revision, 40 band types, a representative
--     catalogue of real earmould/accessory items with real per-band prices).
--   * A spread of customers across the bands actually seen in production
--     (mostly Dispensary / NHS, a couple of B-bands and one Specsavers).
--   * ~250 historical orders spread over the last 5 years (so the Year/Quarter
--     stat graphs show their full rolling window), almost all Dispatched, plus
--     a handful of known recent orders for the customer1 login.
--   * Ordered items priced FROM the price list for each order's band, so the
--     pricelist view, the stat aggregates and per-order totals all line up.
--
-- Login summary (username / password):
--   admin / admin123    manager / manager123    operative / operative123
--   readonly / readonly123    customer1 / customer123   (linked to customer #1)
-- ============================================

-- Wipe all application data and reset sequences so IDs start from 1.
TRUNCATE TABLE
  "OrderStatusHistory",
  "OrderedItems",
  "Order",
  "CustomerAddress",
  "UserSettings",
  "UserAuditLog",
  "Users",
  "VatRates",
  "Customers",
  "GlobalSettings",
  "PriceListItem",
  "PriceListType",
  "PriceListRevision",
  "ItemPrice",
  "Sequences"
RESTART IDENTITY CASCADE;

-- ============================================
-- Customers
--   #1 is kept as the Specsavers branch the customer1 login is linked to.
--   Bands mirror the production mix (mostly Dispensary / NHS, a few B-bands).
-- ============================================
-- NOTE: this is synthetic test data. Contact details use the reserved
-- example.com domain (RFC 2606) and Ofcom's fictional 01632 960xxx phone range
-- so nothing here can collide with a real customer/email/number. Postcodes use
-- placeholder outward+"0AA" codes; company/contact names are invented.
INSERT INTO "Customers" ("AccountNumber", "CentreNumber", "CompanyName", "InvBuildingName", "InvAddressLn1", "InvTownOrCity", "InvCounty", "InvPostCode", "ContactName", "ContactEmail", "ContactPhone", "Band", "Suspended")
VALUES
  ('ACC001', 'C001', 'Northwood Hearing Centre',   'Unit 4',        '1 Sycamore Court',   'London',     'Greater London',     'EC1 0AA', 'Jane Doe',      'contact@northwood-hearing.example.com',  '01632960001', 'Specsavers',  false),
  ('ACC002', 'C002', 'Hampshire Hearing Centre',   NULL,            '12 Maple Avenue',    'Winchester', 'Hampshire',          'SO1 0AA', 'David Roe',     'contact@hampshire-hearing.example.com',  '01632960002', 'Dispensary',  false),
  ('ACC003', 'C003', 'Pennine Audiology Ltd',      'Suite 2',       '47 Birch Street',    'Huddersfield','West Yorkshire',    'HD1 0AA', 'Susan Poe',     'contact@pennine-audiology.example.com',  '01632960003', 'Dispensary',  false),
  ('ACC004', 'C004', 'Riverside Hearing Care',     NULL,            '3 Willow Lane',      'Bristol',    'Avon',               'BS1 0AA', 'Mark Lowe',     'contact@riverside-hearing.example.com',  '01632960004', 'B1',          false),
  ('ACC005', 'C005', 'Clearsound Hearing',         'The Old Bank',  '88 Cedar Road',      'Chester',    'Cheshire',           'CH1 0AA', 'Helen Vale',    'contact@clearsound-hearing.example.com', '01632960005', 'B2',          false),
  ('ACC006', 'C006', 'Meadowvale ENT Clinic',      'Outpatients',   '5 Elm Way',          'Leicester',  'Leicestershire',     'LE1 0AA', 'Alex Rae',      'contact@meadowvale-ent.example.com',     '01632960006', 'NHS Band 1',  false),
  ('ACC007', 'C007', 'Coastal Audiology',          NULL,            '14 Rowan Parade',    'Brighton',   'East Sussex',        'BN1 0AA', 'Gary Webber',   'contact@coastal-audiology.example.com',  '01632960007', 'Dispensary',  false),
  ('ACC008', 'C008', 'The Hearing Practice',       'First Floor',   '22 Aspen Walk',      'Oxford',     'Oxfordshire',        'OX1 0AA', 'Priya Shaw',    'contact@hearing-practice.example.com',   '01632960008', 'Dispensary',  false),
  ('ACC009', 'C009', 'Northgate Audiology',        'Audiology Dept','9 Hazel Close',      'Newcastle',  'Tyne and Wear',      'NE1 0AA', 'Jo Patterson',  'contact@northgate-audiology.example.com','01632960009', 'NHS Band 1',  false),
  ('ACC010', 'C010', 'Bramhall Hearing',           NULL,            '5 Beech Lane',       'Stockport',  'Greater Manchester', 'SK7 0AA', 'Tom Whitley',   'contact@bramhall-hearing.example.com',   '01632960010', 'B3',          false),
  ('ACC011', 'C011', 'Lakeland Hearing Services',  'The Courtyard', '2 Alder Gate',       'Kendal',     'Cumbria',            'LA9 0AA', 'Anne Holland',  'contact@lakeland-hearing.example.com',   '01632960011', 'Dispensary',  false),
  ('ACC012', 'C012', 'City Ear Care',              'Outpatients B', '1 Linden Drive',     'Stoke',      'Staffordshire',      'ST4 0AA', 'Mary Owen',     'contact@city-earcare.example.com',       '01632960012', 'NHS Band 2',  false),
  ('ACC013', 'C013', 'Westfield Hearing',          NULL,            '31 Poplar Road',     'Sheffield',  'South Yorkshire',    'S10 0AA', 'Brian Naylor',  'contact@westfield-hearing.example.com',  '01632960013', 'Dispensary',  true),
  ('ACC014', 'C014', 'Summit Audiology',           'Unit 7B',       '7 Juniper Way',      'Buxton',     'Derbyshire',         'SK17 0AA','Laura Bennett', 'contact@summit-audiology.example.com',   '01632960014', 'B4',          false);

-- Customer Addresses (every customer has a default; #1 has a second site).
INSERT INTO "CustomerAddress" ("CustomerAccount", "SiteCompanyName", "DelAddressLn1", "DelTownOrCity", "DelCounty", "DelPostCode", "SiteContactName", "SiteContactEmail", "SiteContactPhone", "DefaultAddress", "Void")
VALUES
  (1,  'Northwood Hearing - Central',     '1 Sycamore Court',  'London',      'Greater London',     'EC1 0AA', 'Jane Doe',      'contact@northwood-hearing.example.com',  '01632960001', true,  false),
  (1,  'Northwood Hearing - Docklands',   '2 Cherry Plaza',    'London',      'Greater London',     'E14 0AA', 'Tom Reed',      'tom.reed@northwood-hearing.example.com', '01632960101', false, false),
  (2,  'Hampshire Hearing Centre',        '12 Maple Avenue',   'Winchester',  'Hampshire',          'SO1 0AA', 'David Roe',     'contact@hampshire-hearing.example.com',  '01632960002', true,  false),
  (3,  'Pennine Audiology Ltd',           '47 Birch Street',   'Huddersfield','West Yorkshire',     'HD1 0AA', 'Susan Poe',     'contact@pennine-audiology.example.com',  '01632960003', true,  false),
  (4,  'Riverside Hearing Care',          '3 Willow Lane',     'Bristol',     'Avon',               'BS1 0AA', 'Mark Lowe',     'contact@riverside-hearing.example.com',  '01632960004', true,  false),
  (5,  'Clearsound Hearing',              '88 Cedar Road',     'Chester',     'Cheshire',           'CH1 0AA', 'Helen Vale',    'contact@clearsound-hearing.example.com', '01632960005', true,  false),
  (6,  'Meadowvale ENT Clinic',           '5 Elm Way',         'Leicester',   'Leicestershire',     'LE1 0AA', 'Alex Rae',      'contact@meadowvale-ent.example.com',     '01632960006', true,  false),
  (7,  'Coastal Audiology',               '14 Rowan Parade',   'Brighton',    'East Sussex',        'BN1 0AA', 'Gary Webber',   'contact@coastal-audiology.example.com',  '01632960007', true,  false),
  (8,  'The Hearing Practice',            '22 Aspen Walk',     'Oxford',      'Oxfordshire',        'OX1 0AA', 'Priya Shaw',    'contact@hearing-practice.example.com',   '01632960008', true,  false),
  (9,  'Northgate Audiology',             '9 Hazel Close',     'Newcastle',   'Tyne and Wear',      'NE1 0AA', 'Jo Patterson',  'contact@northgate-audiology.example.com','01632960009', true,  false),
  (10, 'Bramhall Hearing',                '5 Beech Lane',      'Stockport',   'Greater Manchester', 'SK7 0AA', 'Tom Whitley',   'contact@bramhall-hearing.example.com',   '01632960010', true,  false),
  (11, 'Lakeland Hearing Services',       '2 Alder Gate',      'Kendal',      'Cumbria',            'LA9 0AA', 'Anne Holland',  'contact@lakeland-hearing.example.com',   '01632960011', true,  false),
  (12, 'City Ear Care',                   '1 Linden Drive',    'Stoke',       'Staffordshire',      'ST4 0AA', 'Mary Owen',     'contact@city-earcare.example.com',       '01632960012', true,  false),
  (13, 'Westfield Hearing',               '31 Poplar Road',    'Sheffield',   'South Yorkshire',    'S10 0AA', 'Brian Naylor',  'contact@westfield-hearing.example.com',  '01632960013', true,  false),
  (14, 'Summit Audiology',                '7 Juniper Way',     'Buxton',      'Derbyshire',         'SK17 0AA','Laura Bennett', 'contact@summit-audiology.example.com',   '01632960014', true,  false);

-- ============================================
-- Users (one per role)
-- ============================================
INSERT INTO "Users" ("Username", "PasswordHash", "FullName", "Email", "Role", "IsActive", "CreatedBy")
VALUES
  ('admin',     '$2b$10$O3fYnnCUI3XJdSqqQsDu8eZ2c2ywSKQSphNpIDNnxE70aiHM0mItO', 'Adam Admin',     'admin@sloms.internal',     'Admin',     true, 'seed'),
  ('manager',   '$2b$10$rkA.f.VF7Pb9HxYBMyttvueyCHmGHRXZn7hwhxzRNzUFsFaxXEj0W', 'Mary Manager',   'manager@sloms.internal',   'Manager',   true, 'seed'),
  ('operative', '$2b$10$Qqm.IsSg943i9k2F1x45k.4YRP2/5ihlvTE9HERPrVV5GycSORGiG', 'Oliver Operative','operative@sloms.internal', 'Operative', true, 'seed'),
  ('readonly',  '$2b$10$.c1SiOwFCEkX7z/7sHgygu1wLT403t71fPbVbaU6RsGVxZbs7GJHW', 'Rachel Readonly', 'readonly@sloms.internal',  'ReadOnly',  true, 'seed'),
  ('customer1', '$2b$10$t1cEg2MpruAlfATz2ag.FOMOOeUZgMnYI6ziktWszqD9wMPvKhVLy', 'Jane Doe',       'contact@northwood-hearing.example.com','Customer',  true, 'seed');

-- Link customer1 to the Northwood Hearing branch (CustomerID 1)
UPDATE "Users" SET "LinkedCustomerID" = 1 WHERE "Username" = 'customer1';

-- ============================================
-- VAT Rates (insert before Orders so FK is satisfied)
-- ============================================
INSERT INTO "VatRates" ("Rate", "Label", "ValidFrom", "ValidTo")
VALUES
  (20.00, 'Standard UK', '2011-01-04', NULL);

-- ============================================
-- Price List
--   One active revision, all 40 band types (so the tblPriceList view columns
--   resolve), and a representative catalogue of real items with real per-band
--   prices for the bands the seeded customers actually use.
-- ============================================
INSERT INTO "PriceListRevision" ("Name", "Status", "ActivatedAt", "Notes", "ImportedBy")
VALUES ('2026 Seed Price List', 'active', NOW(), 'Representative catalogue for the dev/test seed.', 'seed');

-- All 40 band types, in the same order/names the tblPriceList view expects.
INSERT INTO "PriceListType" ("Name", "SortOrder", "IsActive", "CreatedBy")
VALUES
  ('Dispensary', 1, true, 'seed'),           ('Specsavers', 2, true, 'seed'),
  ('Specsavers Band 2023', 3, true, 'seed'), ('B1', 4, true, 'seed'),
  ('B2', 5, true, 'seed'),                   ('B3', 6, true, 'seed'),
  ('B4', 7, true, 'seed'),                   ('5%', 8, true, 'seed'),
  ('6%', 9, true, 'seed'),                   ('10%', 10, true, 'seed'),
  ('50%', 11, true, 'seed'),                 ('Swindon', 12, true, 'seed'),
  ('HealthScreen&Hear4u', 13, true, 'seed'), ('StAnns&Whittington', 14, true, 'seed'),
  ('NHS Band 1', 15, true, 'seed'),          ('NHS Band 2', 16, true, 'seed'),
  ('NHS Band 3', 17, true, 'seed'),          ('NHS Band 4', 18, true, 'seed'),
  ('NHS Band 5', 19, true, 'seed'),          ('NHS Band 6', 20, true, 'seed'),
  ('NHS Band 7', 21, true, 'seed'),          ('NHS Band 8', 22, true, 'seed'),
  ('NHS Band 9', 23, true, 'seed'),          ('NHS Band 10', 24, true, 'seed'),
  ('NHS Band 11', 25, true, 'seed'),         ('NHS Band 12', 26, true, 'seed'),
  ('NHS Band 13', 27, true, 'seed'),         ('NHS Band 14', 28, true, 'seed'),
  ('NHS Band 15', 29, true, 'seed'),         ('NHS Band 16', 30, true, 'seed'),
  ('NHS Band 17', 31, true, 'seed'),         ('NHS Band 18', 32, true, 'seed'),
  ('NHS Band 19', 33, true, 'seed'),         ('NHS Band 20', 34, true, 'seed'),
  ('NHS Band 21', 35, true, 'seed'),         ('NHS Band 22', 36, true, 'seed'),
  ('NHS Band 23', 37, true, 'seed'),         ('NHS Band 24', 38, true, 'seed'),
  ('NHS Band 24 Discount', 39, true, 'seed'),('New Framework Cost', 40, true, 'seed');

-- Catalogue staging: one row per item with prices for the seeded bands.
-- (Real ItemIDs / descriptions / prices sampled from the production price list.)
CREATE TEMP TABLE _seed_cat (
  itemid   text, category text, descr text,
  disp numeric, spec numeric, b1 numeric, b2 numeric, b3 numeric, b4 numeric,
  nhs1 numeric, nhs2 numeric
);
INSERT INTO _seed_cat VALUES
  -- Acrylic moulds / shells / skeletons
  ('EM2101',  'Acrylic', 'Hard Acrylic Solid Mould',                25,    8.3,  5.5,  5.5,  5.5,  5.5,  11,   10.8),
  ('EM2103',  'Acrylic', 'Solid Silicone Solid Mould',             25,    8.3,  6.3,  6.2,  6.1,  6.0,  11,   10.8),
  ('EM2104',  'Acrylic', 'Hard Acrylic, Soft Tip Solid Mould',     25,    8.3,  6.3,  6.2,  6.1,  6.0,  11,   10.8),
  ('EM2106',  'Acrylic', 'Shell Hard Acrylic',                     11,    6.4,  6.7,  6.2,  5.8,  5.5,  9,    8.8),
  ('EM2107',  'Acrylic', 'Hard Acrylic Skeleton',                  11,    NULL, 6.7,  6.2,  5.8,  5.5,  9,    8.8),
  ('EM2114',  'Acrylic', 'Hard Acrylic Canal',                     11,    NULL, 6.7,  6.2,  5.8,  5.5,  9,    8.8),
  ('EM2117',  'Acrylic', 'Hard Acrylic Half Phantom',              12,    NULL, 7.5,  7.2,  6.9,  6.5,  10,   9.8),
  ('EM2119AH','Acrylic', 'Swim Mould Hard Acrylic',                15,    NULL, 9.5,  9.5,  9.5,  9.5,  14,   13.8),
  -- Silicone solids
  ('EM2102A', 'Silicone','Solid Silastic',                         NULL,  NULL, 11.5, 11.5, 11.5, 11.5, NULL, NULL),
  ('EM2102B', 'Silicone','Solid Microflex',                        NULL,  NULL, 9.9,  9.7,  9.3,  8.9,  NULL, NULL),
  ('EM2102BP','Silicone','Solid Biopore',                          NULL,  NULL, 9.9,  9.7,  9.3,  8.9,  NULL, NULL),
  ('EM2102C', 'Silicone','Solid Micropore',                        NULL,  NULL, 9.9,  9.7,  9.3,  8.9,  NULL, NULL),
  -- UV light cured (non-allergenic)
  ('EM2101UV','U.V Light','UV Light Cured (Non-allergenic) Solid Mould', 25, 8.3, 7.9, 7.8, 7.7, 7.6, 11, 10.8),
  ('EM2106UV','U.V Light','Hard UV Light Cured (Non-allergenic) Shell',  12, NULL,8.7, 8.2, 7.8, 7.5, 10, 9.8),
  ('EM2107UV','U.V Light','Hard UV Light Cured (Non-allergenic) Skeleton',12,7.3, 8.7, 8.5, 8.3, 8.0, 10, 9.8),
  -- Specialist materials
  ('EM2112AF','Specialist Material','Audiflex Shell',              25,    NULL, 25,   25,   25,   25,   25,   25),
  ('EM2121AF','Specialist Material','Audiflex Skeleton',           25,    NULL, 25,   25,   25,   25,   25,   25),
  ('EM6001',  'Specialist Material','Thermotec Matt Finish Shell Mould', 95, NULL, 90,  90,   90,   90,   85,   85),
  ('EM6000',  'Specialist Material','Gold Plated Mould',           250,   NULL, NULL, NULL, NULL, NULL, 250,  250),
  -- Tubing
  ('S0035',   'Tube',    'Tube Lock',                              4.5,   3.5,  3.5,  3.5,  3.5,  3.5,  2,    2),
  ('S0036',   'Tube',    '3 mm Libby Horn, Standard',              4.5,   1.5,  3.5,  3.5,  3.5,  3.5,  4.5,  4.5),
  ('S0037',   'Tube',    '3 mm Libby Horn, Stay Dry',              5,     1.5,  9,    9,    9,    9,    4.5,  4.5),
  ('S0039',   'Tube',    '4 mm Libby Horn, Standard',              4.5,   1.75, 1.5,  1.5,  1.5,  1.5,  4.5,  4.5),
  -- Colour / glitter finishes
  ('S0016',   'Colour',  'Marble Effect',                          2,     1,    NULL, NULL, NULL, NULL, 4,    4),
  ('S0019',   'Colour',  'Red',                                    2,     1,    NULL, NULL, NULL, NULL, 2,    2),
  ('S0001',   'Glitter', 'Mother of Pearl Glitter',                2,     1,    1,    1,    1,    1,    2,    2),
  ('S0003',   'Glitter', 'Silver Glitter',                         2,     1,    1,    1,    1,    1,    2,    2),
  -- Filters
  ('S0043',   'Filter',  'Noise Plug Filter (Alpine Filters)',     9,     7,    10,   10,   10,   10,   9,    9),
  -- Services
  ('S0046',   'Service', 'Adult Same Day Service',                 10,    2.5,  7,    7,    7,    7,    8,    8),
  ('S0051',   'Service', 'Mould Scan and Store Service',           2,     NULL, 2,    2,    2,    2,    2,    2),
  ('S0061',   'Service', 'Impression Taking Service',              35,    NULL, NULL, NULL, NULL, NULL, 35,   35),
  -- Postage
  ('S0058',   'Postage', 'Pre-Paid Postage (RM Service)',          8,     2,    8,    8,    8,    8,    8,    8),
  ('S0071',   'Postage', 'Post To Patient Service',                4,     NULL, 4,    4,    4,    4,    4,    4),
  ('S0047',   'Postage', 'Recorded Delivery',                      13.77, NULL, NULL, NULL, NULL, NULL, 13.77,13.77),
  -- Modification
  ('S0050',   'Modification','Mould Modification',                 5,     NULL, NULL, NULL, NULL, NULL, 3,    3);

-- Materialise the catalogue items.
INSERT INTO "PriceListItem" ("ItemID", "Category", "Description", "CreatedBy")
SELECT itemid, category, descr, 'seed' FROM _seed_cat;

-- Unpivot the per-band prices into tblItemPrice for the active revision.
INSERT INTO "ItemPrice" ("ItemID", "ListID", "RevisionID", "Price")
SELECT c.itemid, t."ListID",
       (SELECT "RevisionID" FROM "PriceListRevision" WHERE "Status" = 'active' ORDER BY "RevisionID" DESC LIMIT 1),
       v.price
FROM _seed_cat c
CROSS JOIN LATERAL (VALUES
  ('Dispensary', c.disp), ('Specsavers', c.spec),
  ('B1', c.b1), ('B2', c.b2), ('B3', c.b3), ('B4', c.b4),
  ('NHS Band 1', c.nhs1), ('NHS Band 2', c.nhs2)
) AS v(bandname, price)
JOIN "PriceListType" t ON t."Name" = v.bandname
WHERE v.price IS NOT NULL;

-- ============================================
-- Known recent orders for the customer1 (Specsavers, band Specsavers) login.
-- Small, deterministic, recent + Dispatched so the customer portal has data.
-- Serials prefixed 'D' to stay clear of the generated 'S' serials below.
-- ============================================
INSERT INTO "Order" ("OrderNumber", "OrderBatch", "CustomerAccount", "CustomerRef", "OrderContact", "DeliveryAddress", "ReceivedOn", "DispatchedOn", "VatRateID", "PriceBand", "CreatedOn", "Status", "StatusChangedOn", "Void", "CreatedBy")
VALUES
  (1001, 1, 1, 'NH-REF-001', 'Jane Doe', 1, NOW() - INTERVAL '12 days', NOW() - INTERVAL '8 days',  1, 'Specsavers', NOW() - INTERVAL '12 days', 'Dispatched',   NOW() - INTERVAL '8 days',  false, 'operative'),
  (1002, 1, 1, 'NH-REF-002', 'Tom Reed', 2, NOW() - INTERVAL '6 days',  NOW() - INTERVAL '2 days',  1, 'Specsavers', NOW() - INTERVAL '6 days',  'Dispatched',   NOW() - INTERVAL '2 days',  false, 'operative'),
  (1003, 1, 1, 'NH-REF-003', 'Jane Doe', 1, NOW() - INTERVAL '2 days',  NULL,                       1, 'Specsavers', NOW() - INTERVAL '2 days',  'InProduction', NOW() - INTERVAL '1 day',   false, 'operative');

INSERT INTO "OrderStatusHistory" ("OrderNumber", "OrderBatch", "Status", "ChangedOn") VALUES
  (1001, 1, 'Received', NOW() - INTERVAL '12 days'), (1001, 1, 'InProduction', NOW() - INTERVAL '11 days'), (1001, 1, 'Dispatched', NOW() - INTERVAL '8 days'),
  (1002, 1, 'Received', NOW() - INTERVAL '6 days'),  (1002, 1, 'InProduction', NOW() - INTERVAL '5 days'),  (1002, 1, 'Dispatched', NOW() - INTERVAL '2 days'),
  (1003, 1, 'Received', NOW() - INTERVAL '2 days'),  (1003, 1, 'InProduction', NOW() - INTERVAL '1 day');

INSERT INTO "OrderedItems" ("SerialNumber", "PatientInitial", "PatientSurname", "ModelCode", "CreatedOn", "Week", "ParentOrder", "ParentBatch", "CustomerRef", "Side", "Description", "Category", "Price", "Vent", "Colour", "Tubing", "CheckedOut", "Void", "CreatedBy", "PriceListRevisionID", "PriceListName")
SELECT v."SerialNumber", v."PatientInitial", v."PatientSurname", v."ModelCode",
       v."CreatedOn", extract(week FROM v."CreatedOn")::int, v."ParentOrder", 1, v."CustomerRef",
       v."Side", v."Description", v."Category", v."Price", v."Vent", v."Colour", v."Tubing",
       v."CheckedOut", false, 'operative',
       (SELECT "RevisionID" FROM "PriceListRevision" WHERE "Status" = 'active' ORDER BY "RevisionID" DESC LIMIT 1),
       '2026 Seed Price List'
FROM (VALUES
  ('D00000001','A','Foster',  'EM2101',  NOW() - INTERVAL '12 days', 1001, 'NH-REF-001', 'R', 'Hard Acrylic Solid Mould', 'Acrylic', 8.3,  1.0, NULL,  NULL,        true),
  ('D00000002','A','Foster',  'EM2101',  NOW() - INTERVAL '12 days', 1001, 'NH-REF-001', 'L', 'Hard Acrylic Solid Mould', 'Acrylic', 8.3,  1.0, NULL,  NULL,        true),
  ('D00000003','B','Okafor',  'EM2106',  NOW() - INTERVAL '12 days', 1001, 'NH-REF-001', 'R', 'Shell Hard Acrylic',       'Acrylic', 6.4,  1.5, 'Red', NULL,        true),
  ('D00000004','C','Mason',   'EM2107UV',NOW() - INTERVAL '6 days',  1002, 'NH-REF-002', 'R', 'Hard UV Light Cured (Non-allergenic) Skeleton', 'U.V Light', 7.3, 0.0, NULL, NULL, true),
  ('D00000005','C','Mason',   'S0035',   NOW() - INTERVAL '6 days',  1002, 'NH-REF-002', 'R', 'Tube Lock',                'Tube',    3.5,  0.0, NULL, 'Tube Lock', true),
  ('D00000006','D','Reilly',  'EM2103',  NOW() - INTERVAL '2 days',  1003, 'NH-REF-003', 'L', 'Solid Silicone Solid Mould','Acrylic',8.3,  2.0, NULL, NULL,        false)
) AS v("SerialNumber","PatientInitial","PatientSurname","ModelCode","CreatedOn","ParentOrder","CustomerRef","Side","Description","Category","Price","Vent","Colour","Tubing","CheckedOut");

-- ============================================
-- Global Settings
-- ============================================
INSERT INTO "GlobalSettings" ("Key", "Val", "Description", "Exposed")
VALUES
  ('company.name',           'SLOMS Ltd',                  'Trading company name',            true),
  ('company.address',        '1 Innovation Park|London|EC2A 4NE', 'Company address (pipe-separated lines)', false),
  ('company.email',          'info@sloms.co.uk',           'Company contact email',           true),
  ('company.registrationNo', '12345678',                   'Companies House registration no', false),
  ('company.vatNo',          'GB123456789',                'VAT registration number',         false),
  ('MAX_ORDER_ITEMS',        '50',                         'Max items per order',             false),
  ('WARRANTY_WEEKS',         '104',                        'Warranty period in weeks',        true),
  ('STAT_GRAPH_YEARS',       '5',                          'Number of most recent years shown on the Year/Quarter stat graphs', true);

-- ============================================
-- Generated historical orders
--   ~250 orders spread over the last 5 years, drawn from non-suspended
--   customers, with items priced from the price list for each order's band.
--   Most are Dispatched; a few recent ones are still open.
-- ============================================
DO $seed$
DECLARE
  v_rev        int;
  v_revname    text := '2026 Seed Price List';
  v_g          int;
  v_ordnum     int;
  v_cust       int;
  v_band       text;
  v_addr       int;
  v_received   timestamp;
  v_dispatched timestamp;
  v_status     text;
  v_nitems     int;
  v_i          int;
  v_serial     bigint := 0;
  v_item       record;
  v_side       text;
  surnames     text[] := ARRAY['Smith','Jones','Taylor','Brown','Wilson','Evans','Roberts','Patel','Khan','Clarke','Davies','Hughes','Murphy','Reid','Foster'];
BEGIN
  SELECT "RevisionID" INTO v_rev
  FROM "PriceListRevision" WHERE "Status" = 'active' ORDER BY "RevisionID" DESC LIMIT 1;

  FOR v_g IN 1..250 LOOP
    v_ordnum := 2000 + v_g;

    -- Pick a random non-suspended customer + their band + default address.
    SELECT c."CustomerID", COALESCE(NULLIF(c."Band", ''), 'B1')
      INTO v_cust, v_band
    FROM "Customers" c
    WHERE NOT c."Suspended"
    ORDER BY random() LIMIT 1;

    SELECT a."AddressID" INTO v_addr
    FROM "CustomerAddress" a
    WHERE a."CustomerAccount" = v_cust AND NOT a."Void"
    ORDER BY a."DefaultAddress" DESC, a."AddressID"
    LIMIT 1;

    -- Received some time in the last 5 years.
    v_received := date_trunc('day', NOW())
                  - (floor(random() * 365 * 5))::int * INTERVAL '1 day'
                  - (floor(random() * 9))::int * INTERVAL '1 hour';

    -- Mostly dispatched; recent orders may still be working through the pipeline
    -- (Received -> InProduction -> Ready) so the status workflow has live data.
    IF v_received > NOW() - INTERVAL '21 days' AND random() < 0.55 THEN
      v_status     := (ARRAY['Received','InProduction','InProduction','Ready'])[1 + floor(random() * 4)::int];
      v_dispatched := NULL;
    ELSE
      v_status     := 'Dispatched';
      v_dispatched := v_received + (1 + floor(random() * 9))::int * INTERVAL '1 day';
      IF v_dispatched > NOW() THEN v_dispatched := NOW(); END IF;
    END IF;

    INSERT INTO "Order"
      ("OrderNumber","OrderBatch","CustomerAccount","CustomerRef","OrderContact",
       "DeliveryAddress","ReceivedOn","DispatchedOn","VatRateID","PriceBand",
       "CreatedOn","Status","StatusChangedOn","Void","CreatedBy")
    VALUES
      (v_ordnum, 1, v_cust, 'REF-' || v_ordnum, NULL, v_addr, v_received, v_dispatched,
       1, v_band, v_received, v_status, COALESCE(v_dispatched, v_received), false, 'operative');

    -- Status history: append each stage the order has passed through.
    INSERT INTO "OrderStatusHistory" ("OrderNumber","OrderBatch","Status","ChangedOn")
    VALUES (v_ordnum, 1, 'Received', v_received);
    IF v_status IN ('InProduction','Ready','Dispatched') THEN
      INSERT INTO "OrderStatusHistory" ("OrderNumber","OrderBatch","Status","ChangedOn")
      VALUES (v_ordnum, 1, 'InProduction', v_received + INTERVAL '1 day');
    END IF;
    IF v_status IN ('Ready','Dispatched') THEN
      INSERT INTO "OrderStatusHistory" ("OrderNumber","OrderBatch","Status","ChangedOn")
      VALUES (v_ordnum, 1, 'Ready', v_received + INTERVAL '2 days');
    END IF;
    IF v_status = 'Dispatched' THEN
      INSERT INTO "OrderStatusHistory" ("OrderNumber","OrderBatch","Status","ChangedOn")
      VALUES (v_ordnum, 1, 'Dispatched', v_dispatched);
    END IF;

    -- Item count skewed toward the low end (1..~16).
    v_nitems := 1 + floor(power(random(), 1.8) * 15)::int;

    FOR v_i IN 1..v_nitems LOOP
      -- A catalogue item priced for this band + revision; fall back to B1.
      SELECT i."ItemID" AS itemid, i."Category" AS category, i."Description" AS descr, p."Price" AS price
        INTO v_item
      FROM "PriceListItem" i
      JOIN "ItemPrice" p     ON p."ItemID" = i."ItemID" AND p."RevisionID" = v_rev AND p."Price" > 0
      JOIN "PriceListType" t ON t."ListID" = p."ListID" AND t."Name" = v_band
      WHERE NOT i."Void"
      ORDER BY random() LIMIT 1;

      IF NOT FOUND THEN
        SELECT i."ItemID" AS itemid, i."Category" AS category, i."Description" AS descr, p."Price" AS price
          INTO v_item
        FROM "PriceListItem" i
        JOIN "ItemPrice" p     ON p."ItemID" = i."ItemID" AND p."RevisionID" = v_rev AND p."Price" > 0
        JOIN "PriceListType" t ON t."ListID" = p."ListID" AND t."Name" = 'B1'
        WHERE NOT i."Void"
        ORDER BY random() LIMIT 1;
        CONTINUE WHEN NOT FOUND;
      END IF;

      v_serial := v_serial + 1;
      v_side := CASE WHEN random() < 0.48 THEN 'R' WHEN random() < 0.96 THEN 'L' ELSE '-' END;

      INSERT INTO "OrderedItems"
        ("SerialNumber","PatientInitial","PatientSurname","ModelCode","CreatedOn","Week",
         "ParentOrder","ParentBatch","CustomerRef","Side","Description","Category","Price",
         "Vent","Colour","Tubing","CheckedOut","Void","CreatedBy","PriceListRevisionID","PriceListName")
      VALUES
        ('S' || lpad(v_serial::text, 8, '0'),
         chr(65 + floor(random() * 26)::int),
         surnames[1 + floor(random() * array_length(surnames, 1))::int],
         v_item.itemid, v_received, extract(week FROM v_received)::int,
         v_ordnum, 1, 'REF-' || v_ordnum, v_side,
         left(v_item.descr, 50), v_item.category, v_item.price,
         (ARRAY[0, 1.0, 1.5, 2.0])[1 + floor(random() * 4)::int],
         CASE WHEN random() < 0.85 THEN NULL
              ELSE (ARRAY['Red','Blue','Clear','Beige','Pink'])[1 + floor(random() * 5)::int] END,
         CASE WHEN v_item.category = 'Tube' THEN left(v_item.descr, 50) ELSE NULL END,
         (v_status IN ('Ready','Dispatched')), false, 'operative',
         v_rev, v_revname);
    END LOOP;
  END LOOP;
END
$seed$;

DROP TABLE _seed_cat;
