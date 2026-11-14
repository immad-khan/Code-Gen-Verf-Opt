import os

os.makedirs('public', exist_ok=True)

# Minimal 16x16 uncompressed ICO
# ICO header: 2 bytes reserved (0), 2 bytes type (1=ico), 2 bytes image count (1)
header = b'\x00\x00\x01\x00\x01\x00'
# Directory entry: 16x16, 0 colors, reserved 0, 1 plane, 32 bpp, size of data, offset 22
w, h = 16, 16
bmp_header_size = 40
img_data_size = bmp_header_size + (w * h * 4) + (w * h // 8)
entry = bytes([w, h, 0, 0, 1, 0, 32, 0]) + img_data_size.to_bytes(4, 'little') + (22).to_bytes(4, 'little')
dib = (40).to_bytes(4, 'little') + (16).to_bytes(4, 'little') + (32).to_bytes(4, 'little') + (1).to_bytes(2, 'little') + (32).to_bytes(2, 'little') + b'\x00'*24
pixels = b'\xed\x3a\x7c\xff' * (16 * 16)
mask = b'\x00' * (16 * 16 // 8)
ico_data = header + entry + dib + pixels + mask

with open('public/favicon.ico', 'wb') as f:
    f.write(ico_data)

print('public/favicon.ico written successfully')
