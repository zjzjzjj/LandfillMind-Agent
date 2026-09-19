import os
import zipfile

ROOT = '.'
ZIP_PATH = 'materials/补充资料.zip'

# Directories to include fully
include_dirs = ['src', 'server', 'scripts']

# Specific files to include (root-level)
root_files = [
    'materials/作品简介.md',
    'materials/人机协同履历表.md',
    'materials/参赛技术说明文档.md',
    '参赛技术说明文档.md',
    '视频脚本.md',
    'CHANGELOG.md',
    'DEPLOY.md',
    'README.md',
    'package.json',
    'package-lock.json',
    'render.yaml',
    'tsconfig.json',
    'tsconfig.node.json',
    'vite.config.ts',
]

# Exclude patterns
EXCLUDE_DIRS = {'node_modules', 'dist', '.git', 'data', 'test-screenshots', '__pycache__'}
EXCLUDE_EXTS = {'.log'}

def should_exclude(path):
    parts = path.replace(os.sep, '/').split('/')
    for p in parts:
        if p in EXCLUDE_DIRS:
            return True
    _, ext = os.path.splitext(path)
    if ext in EXCLUDE_EXTS:
        return True
    return False

count = 0
total_size = 0
file_list = []
with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    # Add directories
    for d in include_dirs:
        if not os.path.isdir(d):
            print(f'SKIP missing dir: {d}')
            continue
        for root, dirs, files in os.walk(d):
            # prune exclude dirs
            dirs[:] = [x for x in dirs if x not in EXCLUDE_DIRS]
            for f in files:
                fp = os.path.join(root, f)
                if should_exclude(fp):
                    continue
                zf.write(fp, fp)
                count += 1
                total_size += os.path.getsize(fp)
                file_list.append(fp)
    # Add root files
    for rf in root_files:
        if not os.path.exists(rf):
            print(f'SKIP missing file: {rf}')
            continue
        zf.write(rf, rf)
        count += 1
        total_size += os.path.getsize(rf)
        file_list.append(rf)

print(f'Files in zip: {count}')
print(f'Raw size: {total_size} bytes ({total_size/1024:.1f} KB)')
print(f'Zip size: {os.path.getsize(ZIP_PATH)} bytes ({os.path.getsize(ZIP_PATH)/1024:.1f} KB)')
print(f'Zip path: {ZIP_PATH}')
# Print first 20 files for verification
print('--- First 20 files ---')
for f in file_list[:20]:
    print(f)