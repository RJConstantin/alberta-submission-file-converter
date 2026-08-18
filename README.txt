Coordinate System Converter - GitHub Pages

Upload index.html to the root of the GitHub Pages repository.

Input/output formats in this version include:
- Alberta 10TM (Meters / Feet / US Feet)
- Alberta 3TM (Meters / Feet / US Feet)
- UTM (Meters / Feet / US Feet)
- Decimal Degrees (Degrees)
- Degrees Minutes Seconds (Degrees)
- Degrees Decimal Minutes (Degrees)
- MGRS
- US National Grid
- Alberta Township System (ATS / Legal Land Description)

ATS input accepts common legal land formats such as:
- 14-32-95-11-W4M
- 8-5-96-6 W4M
- NE-9-73-17-W4M
- QS-NE SEC-24 TWP-090 RGE-10 MER-4
- SEC-15 TWP-73 RGE-17 MER-4

When converting from ATS to a coordinate format, the output point is the centre of the matching official ATS parcel. ATS conversions require an internet connection because the page queries the Government of Alberta public Alberta Township System map service.

The converter remains location-aware and can automatically correct a missing west/negative longitude sign when the selected expected location supports the correction.
