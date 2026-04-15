(function() {
  "use strict";

  const STORAGE_KEY = "sim2real-theme";
  const html = document.documentElement;
  let currentAccountPayload = null;

  function applyTheme(theme) {
    html.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      const sun = button.querySelector(".icon-sun");
      const moon = button.querySelector(".icon-moon");
      if (sun && moon) {
        sun.style.display = theme === "dark" ? "none" : "block";
        moon.style.display = theme === "dark" ? "block" : "none";
      }
    });
  }

  function initTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyTheme(stored || preferred);
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      button.addEventListener("click", () => {
        const nextTheme = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
        applyTheme(nextTheme);
      });
    });
  }

  function initMobileNav() {
    const button = document.querySelector(".mobile-menu-btn");
    const nav = document.querySelector(".mobile-nav");
    if (!button || !nav) return;

    button.addEventListener("click", () => {
      const active = nav.classList.toggle("active");
      button.setAttribute("aria-expanded", String(active));
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("active");
        button.setAttribute("aria-expanded", "false");
      });
    });
  }

  function setTemporaryState(button, working, done) {
    if (!button) return () => {};
    const original = button.textContent;
    button.textContent = working;
    button.disabled = true;
    return function restore() {
      button.textContent = done;
      setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 1800);
    };
  }

  function getCsrfToken() {
    const match = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("sim2real_csrf="));
    return match ? decodeURIComponent(match.slice("sim2real_csrf=".length)) : "";
  }

  async function submitJson(url, payload) {
    const headers = { "content-type": "application/json" };
    const csrf = getCsrfToken();
    if (csrf) {
      headers["x-csrf-token"] = csrf;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    if (response.status === 429) {
      throw new Error("Too many requests. Please wait a moment and try again.");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "Request failed.");
    }
    return body;
  }

  function setPanelMessage(target, message, tone) {
    if (!target) return;
    target.textContent = message || "";
    if (tone) {
      target.dataset.tone = tone;
    } else {
      delete target.dataset.tone;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initForms() {
    document.querySelectorAll("form[data-handler]").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button[type='submit']");
        const data = Object.fromEntries(new FormData(form).entries());

        try {
          if (form.getAttribute("data-handler") === "contact") {
            const restore = setTemporaryState(button, "Sending...", "Message sent");
            await submitJson("/api/contact", data);
            form.reset();
            restore();
            return;
          }

          if (form.getAttribute("data-handler") === "signup") {
            const restore = setTemporaryState(button, "Creating account...", "Account created");
            await submitJson("/api/auth/signup", data);
            form.reset();
            restore();
            return;
          }

          if (form.getAttribute("data-handler") === "login") {
            const restore = setTemporaryState(button, "Signing in...", "Signed in");
            await submitJson("/api/auth/login", data);
            restore();
            window.location.href = "/billing.html";
            return;
          }

          if (form.getAttribute("data-handler") === "forgot-password") {
            const restore = setTemporaryState(button, "Sending reset link...", "Reset link requested");
            await submitJson("/api/auth/forgot-password", data);
            form.reset();
            restore();
            return;
          }

          if (form.getAttribute("data-handler") === "reset-password") {
            const restore = setTemporaryState(button, "Updating password...", "Password updated");
            await submitJson("/api/auth/reset-password", data);
            form.reset();
            restore();
            setTimeout(() => {
              window.location.href = "/login.html";
            }, 1000);
            return;
          }
        } catch (error) {
          window.alert(error.message);
          if (button) {
            button.disabled = false;
          }
        }
      });
    });
  }

  function initStripePlaceholders() {
    document.querySelectorAll("[data-stripe-checkout]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const plan = button.getAttribute("data-stripe-checkout");
        submitJson("/api/billing/checkout", { plan })
          .then((payload) => {
            if (payload.url) {
              window.location.href = payload.url;
              return;
            }
            throw new Error("Checkout URL was not returned.");
          })
          .catch((error) => window.alert(error.message));
      });
    });

    document.querySelectorAll("[data-stripe-portal]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        submitJson("/api/billing/portal", {})
          .then((payload) => {
            if (payload.url) {
              window.location.href = payload.url;
              return;
            }
            throw new Error("Billing portal URL was not returned.");
          })
          .catch((error) => window.alert(error.message));
      });
    });
  }

  function renderWorkspaceMetrics(metrics) {
    const container = document.querySelector("#workspace-metrics");
    if (!container || !metrics) return;

    container.innerHTML = [
      ["Active robots", metrics.activeRobots],
      ["Transfer success rate", metrics.transferSuccessRate],
      ["Open failure clusters", metrics.openFailureClusters],
      ["Recommended updates", metrics.recommendedUpdates]
    ].map(([label, value]) => (
      `<article class="metric-card"><span class="metric-card__label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`
    )).join("");
  }

  function renderWorkspaceIdentity(user, subscription, metrics) {
    const container = document.querySelector("#workspace-identity");
    if (!container || !user || !subscription || !metrics) return;

    container.innerHTML = [
      subscription.plan,
      subscription.status,
      `${user.company || user.email}`,
      `${metrics.openFailureClusters} open clusters`
    ].map((value) => `<span class="workspace-chip">${escapeHtml(value)}</span>`).join("");
  }

  function renderDeployments(deployments) {
    const container = document.querySelector("#deployment-list");
    if (!container) return;
    if (!deployments || !deployments.length) {
      container.innerHTML = `<p class="empty-state">No deployment telemetry is available yet.</p>`;
      return;
    }

    container.innerHTML = deployments.map((deployment) => `
      <article class="telemetry-item">
        <div class="telemetry-item__header">
          <div>
            <div class="telemetry-item__title">${escapeHtml(deployment.robotName)}</div>
            <p>${escapeHtml(deployment.site)} · ${escapeHtml(deployment.task)}</p>
          </div>
          <span class="severity-pill">${escapeHtml(deployment.status)}</span>
        </div>
        <div class="telemetry-meta">
          <div><span>Sim confidence</span><strong>${escapeHtml(deployment.simConfidence)}</strong></div>
          <div><span>Real-world success</span><strong>${escapeHtml(deployment.realWorldSuccessRate)}</strong></div>
          <div><span>Drift score</span><strong>${escapeHtml(deployment.driftScore)}</strong></div>
        </div>
        <div class="telemetry-controls">
          <label for="deployment-${escapeHtml(deployment.id)}">Status</label>
          <select id="deployment-${escapeHtml(deployment.id)}" data-deployment-status="${escapeHtml(deployment.id)}">
            ${["Monitoring", "Needs review", "Retraining queued", "Stable"].map((status) => (
              `<option value="${escapeHtml(status)}"${status === deployment.status ? " selected" : ""}>${escapeHtml(status)}</option>`
            )).join("")}
          </select>
          <span class="inline-feedback" data-deployment-feedback="${escapeHtml(deployment.id)}"></span>
        </div>
      </article>
    `).join("");
  }

  function renderFailureTrends(trends) {
    const container = document.querySelector("#failure-trend-list");
    if (!container) return;
    if (!trends || !trends.length) {
      container.innerHTML = `<p class="empty-state">No failure clusters are available yet.</p>`;
      return;
    }

    container.innerHTML = trends.map((trend) => `
      <article class="trend-item">
        <div class="trend-item__title">${escapeHtml(trend.label)}</div>
        <div class="trend-item__body">
          <strong>${escapeHtml(trend.severity)} severity · ${escapeHtml(trend.count)} events</strong>
          <p>${escapeHtml(trend.summary)}</p>
        </div>
      </article>
    `).join("");
  }

  function renderRecommendations(recommendations) {
    const container = document.querySelector("#recommendation-list");
    if (!container) return;
    if (!recommendations || !recommendations.length) {
      container.innerHTML = `<p class="empty-state">No simulation recommendations are available yet.</p>`;
      return;
    }

    container.innerHTML = recommendations.map((recommendation) => `
      <article class="recommendation-item">
        <div class="recommendation-item__header">
          <div>
            <div class="recommendation-item__title">${escapeHtml(recommendation.title)}</div>
            <p>${escapeHtml(recommendation.theme)}</p>
          </div>
          <button class="btn btn--ghost" data-recommendation-ack="${escapeHtml(recommendation.id)}"${recommendation.acknowledged ? " disabled" : ""}>
            ${recommendation.acknowledged ? "Acknowledged" : "Acknowledge"}
          </button>
        </div>
        <div class="recommendation-item__body">
          <p>${escapeHtml(recommendation.action)}</p>
        </div>
        <div class="recommendation-meta">
          <div><span>Expected impact</span><strong>${escapeHtml(recommendation.expectedImpact)}</strong></div>
          <div><span>Confidence</span><strong>${escapeHtml(recommendation.confidence)}</strong></div>
          <div><span>Status</span><strong>${recommendation.acknowledged ? "Acknowledged" : "Pending review"}</strong></div>
        </div>
      </article>
    `).join("");
  }

  function appendNote(note) {
    const container = document.querySelector("#note-list");
    if (!container || !note) return;
    const current = container.querySelector(".empty-state");
    if (current) {
      container.innerHTML = "";
    }
    container.insertAdjacentHTML("afterbegin", `
      <article class="note-item">
        <div class="note-item__header">
          <strong>${escapeHtml(note.author)}</strong>
          <span>${escapeHtml(new Date(note.createdAt).toLocaleString())}</span>
        </div>
        <div class="note-item__body">${escapeHtml(note.message)}</div>
      </article>
    `);
  }

  function renderNotes(notes) {
    const container = document.querySelector("#note-list");
    if (!container) return;
    if (!notes || !notes.length) {
      container.innerHTML = `<p class="empty-state">No operator notes yet. Capture a handoff, retraining note, or site update.</p>`;
      return;
    }

    container.innerHTML = "";
    notes.forEach((note) => appendNote(note));
  }

  function renderAccountSettings(user, subscription, invoices) {
    const summary = document.querySelector("#account-summary");
    const invoicesNode = document.querySelector("#invoice-history");
    if (summary && user && subscription) {
      summary.innerHTML = [
        ["Plan", subscription.plan],
        ["Billing status", subscription.status],
        ["Billing interval", subscription.billingInterval],
        ["Customer", user.email],
        ["Company", user.company || "Not set"]
      ].map(([label, value]) => (
        `<div class="billing-detail"><span class="billing-detail__label">${escapeHtml(label)}</span><span class="billing-detail__value">${escapeHtml(value)}</span></div>`
      )).join("");
    }

    if (invoicesNode && invoices) {
      invoicesNode.innerHTML = invoices.map((invoice) => (
        `<div class="billing-detail"><span class="billing-detail__label">${escapeHtml(invoice.month)}</span><span class="billing-detail__value">${escapeHtml(invoice.status)}</span></div>`
      )).join("");
    }

    const nameField = document.querySelector("#profile-name");
    const emailField = document.querySelector("#profile-email");
    const companyField = document.querySelector("#profile-company");
    const customerField = document.querySelector("#profile-customer-id");
    if (nameField) nameField.value = user.name || "";
    if (emailField) emailField.value = user.email || "";
    if (companyField) companyField.value = user.company || "";
    if (customerField) customerField.value = user.stripeCustomerId || "Not created yet";
  }

  function bindDashboardActions() {
    document.querySelectorAll("[data-recommendation-ack]").forEach((button) => {
      button.addEventListener("click", async () => {
        const recommendationId = button.getAttribute("data-recommendation-ack");
        button.disabled = true;
        try {
          await submitJson(`/api/dashboard/recommendations/${recommendationId}/acknowledge`, {});
          button.textContent = "Acknowledged";
          const strong = button.closest(".recommendation-item")?.querySelector(".recommendation-meta strong:last-child");
          if (strong) {
            strong.textContent = "Acknowledged";
          }
        } catch (error) {
          button.disabled = false;
          button.textContent = "Acknowledge";
        }
      });
    });

    document.querySelectorAll("[data-deployment-status]").forEach((select) => {
      select.addEventListener("change", async () => {
        const deploymentId = select.getAttribute("data-deployment-status");
        const feedback = document.querySelector(`[data-deployment-feedback="${deploymentId}"]`);
        try {
          await submitJson(`/api/dashboard/deployments/${deploymentId}/status`, { status: select.value });
          setPanelMessage(feedback, "Status saved", "success");
          const pill = select.closest(".telemetry-item")?.querySelector(".severity-pill");
          if (pill) {
            pill.textContent = select.value;
          }
        } catch (error) {
          setPanelMessage(feedback, error.message, "error");
        }
      });
    });

    const noteForm = document.querySelector("#note-form");
    noteForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.querySelector("#note-form-status");
      const data = Object.fromEntries(new FormData(noteForm).entries());
      try {
        const payload = await submitJson("/api/dashboard/notes", data);
        appendNote(payload.note);
        noteForm.reset();
        setPanelMessage(status, "Note saved to the workspace.", "success");
      } catch (error) {
        setPanelMessage(status, error.message, "error");
      }
    });

    const profileForm = document.querySelector("#profile-form");
    profileForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.querySelector("#profile-form-status");
      const data = Object.fromEntries(new FormData(profileForm).entries());
      try {
        const payload = await submitJson("/api/account/profile", data);
        if (currentAccountPayload) {
          currentAccountPayload.user = {
            ...currentAccountPayload.user,
            ...payload.user
          };
          renderWorkspaceIdentity(
            currentAccountPayload.user,
            currentAccountPayload.subscription,
            currentAccountPayload.workspaceMetrics
          );
          renderAccountSettings(
            currentAccountPayload.user,
            currentAccountPayload.subscription,
            currentAccountPayload.invoices
          );
        }
        setPanelMessage(status, "Profile updated for this workspace.", "success");
      } catch (error) {
        setPanelMessage(status, error.message, "error");
      }
    });

    const passwordForm = document.querySelector("#password-form");
    passwordForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.querySelector("#password-form-status");
      const data = Object.fromEntries(new FormData(passwordForm).entries());
      try {
        await submitJson("/api/account/password", data);
        passwordForm.reset();
        setPanelMessage(status, "Password changed. Redirecting to login…", "success");
        // All sessions are invalidated server-side on password change — force re-login
        setTimeout(() => { window.location.href = "/login.html"; }, 1500);
      } catch (error) {
        setPanelMessage(status, error.message, "error");
      }
    });
  }

  async function hydrateBillingPage() {
    const summary = document.querySelector("#account-summary");
    if (!summary) return;

    try {
      const response = await fetch("/api/account");
      if (response.status === 401) {
        window.location.href = "/login.html";
        return;
      }
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      currentAccountPayload = payload;
      renderWorkspaceIdentity(payload.user, payload.subscription, payload.workspaceMetrics);
      renderWorkspaceMetrics(payload.workspaceMetrics);
      renderDeployments(payload.deployments);
      renderFailureTrends(payload.failureTrends);
      renderRecommendations(payload.recommendations);
      renderNotes(payload.notes);
      renderAccountSettings(payload.user, payload.subscription, payload.invoices);
      bindDashboardActions();
    } catch (error) {
      console.error(error);
    }
  }

  function initLogoutButtons() {
    document.querySelectorAll("[data-auth-logout]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          await submitJson("/api/auth/logout", {});
          window.location.href = "/login.html";
        } catch (error) {
          window.alert(error.message);
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initMobileNav();
    initForms();
    initStripePlaceholders();
    hydrateBillingPage();
    initLogoutButtons();
  });
})();
