# burnday

## Source

Originally parsed from a Google Sheet, though Placer county recently (2023 EOY burn season) switched to a better site, parsed from [Placer County Air Pollution Control District](https://itwebservices.placer.ca.gov/APCDBDI/home/).

As of late 2026 the county stopped updating that page (stuck on 6/15/26) and moved to the [Burn Day Status](https://experience.arcgis.com/experience/572b2af789e94b2f888c5e0c2b88a589) ArcGIS experience. We now query its public [feature layer](https://services9.arcgis.com/NENkjkswKTzMfG3A/arcgis/rest/services/Burn_Day_Status_Public/FeatureServer/0) for the "Western Placer County" row, and fall back to scraping the old site if that fails or is stale.
