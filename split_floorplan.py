"""
split_floorplan.py — Split the composite 2×3 Kellogg floor plan image
into 6 individual floor images.

Layout of kellogg_floorplan.jpg:
  Top row:    Lower Level (LL), Level 1 (L1), Level 2 (L2)
  Bottom row: Level 3 (L3),     Level 4 (L4), Level 5 (L5)

Usage:
  python split_floorplan.py
"""

from PIL import Image
import os

INPUT = "media/kellogg_floorplan.jpg"
OUTPUT_DIR = "media"

# The image is a 2-row × 3-column grid.
# We'll split it into equal thirds horizontally and halves vertically,
# then save each cell.

FLOORS = [
    # (id, row, col)
    ("LL", 0, 0),  # Top-left
    ("L1", 0, 1),  # Top-center
    ("L2", 0, 2),  # Top-right
    ("L3", 1, 0),  # Bottom-left
    ("L4", 1, 1),  # Bottom-center
    ("L5", 1, 2),  # Bottom-right
]

def main():
    img = Image.open(INPUT)
    w, h = img.size
    print(f"Source image: {w} x {h} px")

    col_w = w // 3
    row_h = h // 2

    print(f"Grid cell size: {col_w} x {row_h} px")

    for floor_id, row, col in FLOORS:
        left = col * col_w
        upper = row * row_h
        right = left + col_w
        lower = upper + row_h

        # Handle rounding on the last column/row
        if col == 2:
            right = w
        if row == 1:
            lower = h

        crop = img.crop((left, upper, right, lower))

        out_path = os.path.join(OUTPUT_DIR, f"floor_{floor_id}.jpg")
        crop.save(out_path, "JPEG", quality=92)
        print(f"  OK {out_path}  ({crop.size[0]} x {crop.size[1]} px)")

    print(f"\nDone! {len(FLOORS)} floor images saved to {OUTPUT_DIR}/")

if __name__ == "__main__":
    main()
