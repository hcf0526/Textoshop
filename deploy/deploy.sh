#!/usr/bin/env bash
# 本地构建镜像，经本地临时镜像仓库与 SSH 反向隧道让服务器 docker pull，只传输变动的层。
# 服务器上无需安装 Node 或构建镜像。
# 用法 bash deploy/deploy.sh
# 部署参数写在 deploy/deploy.env（不进仓库），或用同名环境变量传入
#   DEPLOY_HOST          服务器的 SSH 主机名
#   DEPLOY_PULL_HOST     传输镜像用的 SSH 主机名，可经代理，默认同 DEPLOY_HOST
#   DEPLOY_PROXY_SCRIPT  传输期间启停代理的脚本，可选，参数为 start 或 stop
#   DEPLOY_REMOTE_DIR    服务器上的部署目录，内含 compose.yaml 与 data/
# 服务器上需提前准备 data/users.json 与 data/secret
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f deploy/deploy.env ] && . deploy/deploy.env

HOST=${DEPLOY_HOST:?请在 deploy/deploy.env 设置 DEPLOY_HOST}
PULL_HOST=${DEPLOY_PULL_HOST:-$HOST}
PROXY_SCRIPT=${DEPLOY_PROXY_SCRIPT:-}
REMOTE_DIR=${DEPLOY_REMOTE_DIR:?请在 deploy/deploy.env 设置 DEPLOY_REMOTE_DIR}
IMAGE=textoshop:latest
REG_PORT=15999
REG_IMAGE=127.0.0.1:$REG_PORT/$IMAGE
DOCKER=${DOCKER:-docker}

# SSH 偶尔被服务器断开，预检最多试 3 次，退出码 255 表示连接失败
for i in 1 2 3; do
  set +e; ssh -o ConnectTimeout=15 "$HOST" "test -f $REMOTE_DIR/data/users.json && test -f $REMOTE_DIR/data/secret"; rc=$?; set -e
  [ $rc -ne 255 ] && break
  echo "SSH 连接失败，第 $i 次重试"; sleep 3
done
[ $rc -eq 255 ] && { echo "SSH 连接失败"; exit 1; }
[ $rc -ne 0 ] && { echo "服务器缺少 $REMOTE_DIR/data/users.json 或 secret"; exit 1; }

echo "==> 本地构建 $IMAGE"
$DOCKER build --platform linux/amd64 -t "$IMAGE" .

echo "==> 推送到本地临时仓库"
$DOCKER start ts_registry >/dev/null 2>&1 \
  || $DOCKER run -d --name ts_registry -p 127.0.0.1:$REG_PORT:5000 registry:2 >/dev/null
sleep 1
$DOCKER tag "$IMAGE" "$REG_IMAGE"
$DOCKER push -q "$REG_IMAGE"

# 传输期间开启代理，结束后关闭，传输主机连不上时改走直连
if [ -n "$PROXY_SCRIPT" ]; then
  "$PROXY_SCRIPT" start; trap '"$PROXY_SCRIPT" stop; $DOCKER stop ts_registry >/dev/null' EXIT
else trap '$DOCKER stop ts_registry >/dev/null' EXIT; fi
if [ "$PULL_HOST" != "$HOST" ] && ! ssh -o ConnectTimeout=20 "$PULL_HOST" true 2>/dev/null; then
  echo "传输主机不可用，改走直连"; PULL_HOST=$HOST
fi

echo "==> 服务器拉取变动的层"
ssh -o ExitOnForwardFailure=yes -R $REG_PORT:127.0.0.1:$REG_PORT "$PULL_HOST" \
  "docker pull -q $REG_IMAGE && docker tag $REG_IMAGE $IMAGE && docker rmi -f $REG_IMAGE >/dev/null"

echo "==> 同步 compose 并重启"
scp -q deploy/compose.yaml "$HOST:$REMOTE_DIR/compose.yaml"
ssh "$HOST" "docker compose -p textoshop -f $REMOTE_DIR/compose.yaml up -d --force-recreate && docker image prune -f >/dev/null"

echo "==> 完成"
ssh "$HOST" "docker ps --filter name=textoshop --format '{{.Names}} {{.Status}} {{.Ports}}'"
