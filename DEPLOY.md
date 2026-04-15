# Sim2Real Railway Deployment Guide

## Prerequisites

- Railway account with CLI installed (`npm i -g @railway/cli`)
- Stripe account with billing configured
- Domain (optional, for production)

## One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/new)

## Manual Deploy

### 1. Initialize Railway Project

```bash
cd Sim2Real
railway login
railway init --name sim2real
railway up --detach
```

### 2. Configure Environment Variables

Set these in Railway dashboard or via CLI:

```bash
# Required
railway variables set NODE_ENV=production
railway variables set SESSION_SECRET=$(openssl rand -hex 32)
railway variables set PORT=3000

# Stripe (get from dashboard.stripe.com/apikeys)
railway variables set STRIPE_SECRET_KEY=sk_live_xxx
railway variables set STRIPE_PRICE_ID_PILOT=price_xxx
railway variables set STRIPE_WEBHOOK_SECRET=whsec_xxx

# Allowed hosts
railway variables set ALLOWED_HOSTS=your-app.up.railway.app
```

### 3. Attach Database (Optional)

The app uses file-based storage by default. For production durability:

```bash
railway add postgres
# Update server.js to use DATABASE_URL when available
```

### 4. Configure Stripe Webhook

After deploy, configure Stripe to send webhooks to Railway:

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://your-app.up.railway.app/api/webhooks/stripe`
3. Select events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `checkout.session.completed`
4. Copy the signing secret to Railway:
   ```bash
   railway variables set STRIPE_WEBHOOK_SECRET=whsec_xxx
   ```

### 5. Verify Deployment

```bash
# Health check
curl https://your-app.up.railway.app/health

# Should return:
# {"status":"ok","db":"connected","version":"0.1.0","uptime":...}

# Readiness check
curl https://your-app.up.railway.app/ready

# Should return:
# {"ready":true,"canServeTraffic":true,...}
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | `development` | Must be `production` in prod |
| `PORT` | Yes | `3000` | Railway injects this automatically |
| `SESSION_SECRET` | Yes | `sim2real-dev-secret` | 32+ char random string |
| `STRIPE_SECRET_KEY` | For billing | - | Stripe API key |
| `STRIPE_PRICE_ID_PILOT` | For billing | - | Stripe Price ID for Pilot plan |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | - | Stripe webhook signing secret |
| `ALLOWED_HOSTS` | Recommended | `*` | Comma-separated allowed hosts |
| `PBKDF2_ITERATIONS` | No | `100000` | Password hash iterations |
| `LOG_LEVEL` | No | `info` | debug, info, warn, error |

## Monitoring

### Logs

```bash
railway logs --follow
```

### Health Endpoints

- `/health` - Returns 200 if server is running
- `/ready` - Returns 200 if ready to serve traffic

### Metrics

Railway provides built-in metrics:
- Request count
- Response latency
- Error rate
- Memory/CPU usage

View at: https://railway.app/project/your-project

## Troubleshooting

### App won't start

Check logs for missing environment variables:

```bash
railway logs
```

Common issues:
- Missing `SESSION_SECRET` in production
- Invalid `STRIPE_SECRET_KEY` format
- Port not bound to `0.0.0.0`

### Stripe webhook failing

1. Verify webhook URL is reachable from outside
2. Check `STRIPE_WEBHOOK_SECRET` matches Stripe dashboard
3. Review logs for signature verification failures

### Database issues

The app uses file-based storage (`.data/` directory). For production:
- Consider attaching Railway Postgres
- Implement backup strategy for `.data/` files

## Scaling

### Increase Replicas

```bash
railway scale set web=2
```

### Increase Resources

In Railway dashboard:
1. Go to service settings
2. Adjust CPU/Memory limits
3. Deploy changes

## Security Checklist

- [ ] `SESSION_SECRET` is random 32+ characters
- [ ] `NODE_ENV=production` is set
- [ ] Stripe keys are for production (sk_live_*)
- [ ] `ALLOWED_HOSTS` restricts to your domain
- [ ] HTTPS is enforced (Railway provides this by default)
- [ ] Webhook signature verification is enabled

## Rollback

```bash
# List deployments
railway deployments

# Rollback to previous
railway rollback <deployment-id>
```

## Support

- Railway Docs: https://docs.railway.app
- Sim2Real Issues: https://github.com/your-org/sim2real/issues
