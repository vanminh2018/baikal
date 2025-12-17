#!/bin/bash

# Script để chạy Baikal Sync từ bất kỳ thư mục nào
# Tự động xác định đường dẫn và sử dụng môi trường ảo (venv)

# Lấy đường dẫn tuyệt đối đến thư mục chứa script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/baikal_sync.py"
REQUIREMENTS_FILE="$SCRIPT_DIR/requirements.txt"
VENV_DIR="$SCRIPT_DIR/.venv"

# Kiểm tra xem file Python có tồn tại không
if [ ! -f "$PYTHON_SCRIPT" ]; then
    echo "Lỗi: Không tìm thấy file $PYTHON_SCRIPT"
    exit 1
fi

# Kiểm tra xem file requirements.txt có tồn tại không
if [ ! -f "$REQUIREMENTS_FILE" ]; then
    echo "Lỗi: Không tìm thấy file $REQUIREMENTS_FILE"
    exit 1
fi

# Kiểm tra Python có được cài đặt không
if ! command -v python3 &> /dev/null; then
    echo "Lỗi: Python3 không được cài đặt. Vui lòng cài đặt Python3 trước."
    exit 1
fi

# Kiểm tra xem venv có tồn tại không, nếu chưa thì tạo mới
if [ ! -d "$VENV_DIR" ]; then
    echo "Tạo môi trường ảo (venv)..."
    python3 -m venv "$VENV_DIR"
    if [ $? -ne 0 ]; then
        echo "Lỗi: Không thể tạo môi trường ảo. Vui lòng kiểm tra lại cài đặt Python3."
        exit 1
    fi
fi

# Kích hoạt môi trường ảo
echo "Kích hoạt môi trường ảo..."
source "$VENV_DIR/bin/activate"

# Cập nhật pip trong venv
echo "Cập nhật pip..."
pip install --upgrade pip

# Cài đặt dependencies trong venv
echo "Kiểm tra và cài đặt dependencies..."
pip install -r "$REQUIREMENTS_FILE"

# Chạy script Python với đường dẫn tuyệt đối
echo "Chạy Baikal Sync script..."
python "$PYTHON_SCRIPT" "$@"