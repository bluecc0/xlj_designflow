@echo off
setlocal
cd /d "%~dp0"
title 安装抠图环境依赖 (PyTorch + CUDA + Transformers)

set VENV_PYTHON="%~dp0.venv\Scripts\python.exe"
set VENV_PIP="%~dp0.venv\Scripts\pip.exe"

if not exist %VENV_PYTHON% (
    echo 未找到 .venv 环境，请先运行 start.example.bat 创建基础环境。
    pause
    exit /b 1
)

echo.
echo =======================================================
echo  正在安装 PyTorch (CUDA 12.4) 与 BiRefNet 抠图模型依赖...
echo =======================================================
echo.

%VENV_PIP% install torch torchvision --index-url https://download.pytorch.org/whl/cu124
if errorlevel 1 (
    echo.
    echo PyTorch 安装失败，请检查网络或代理设置。
    pause
    exit /b 1
)

%VENV_PIP% install transformers timm einops huggingface_hub
if errorlevel 1 (
    echo.
    echo 抠图模型组件安装失败。
    pause
    exit /b 1
)

echo.
echo =======================================================
echo  验证 GPU / CUDA 加速可用性...
echo =======================================================
%VENV_PYTHON% -c "import torch; print('PyTorch Version:', torch.__version__, '| CUDA Available:', torch.cuda.is_available(), '| Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"

echo.
echo ✅ 抠图环境配置完成！
pause
