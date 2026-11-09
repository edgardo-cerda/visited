import { html, mount, $ } from '../html.js';
import { me, login, register } from '../store.js';
import { toast } from '../components.js';

function showError(form, e) {
  const box = $('.form-error', form);
  box.hidden = false;
  box.textContent = e.message;
  form.querySelectorAll('.invalid').forEach((x) => x.classList.remove('invalid'));
  if (e.field) form.querySelector(`[name="${e.field}"]`)?.classList.add('invalid');
}

export async function loginView(ctx) {
  document.title = 'Ingresar · Visited Chile';
  if (me()) return ctx.navigate(`/u/${me().username}`, { replace: true });
  mount(ctx.root, html`
    <section class="auth">
      <h1>Ingresar</h1>
      <form class="card form" id="login-form" novalidate>
        <label class="field"><span>Usuario o email</span><input name="login" autocomplete="username" required autofocus></label>
        <label class="field"><span>Contraseña</span><input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">Entrar</button>
      </form>
      <p class="muted center">¿No tienes cuenta? <a href="/registro">Crea una</a></p>
    </section>`);
  const form = $('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await login(String(fd.get('login')).trim(), String(fd.get('password')));
      toast(`¡Hola, ${me().displayName}!`, 'ok');
      const next = ctx.query.get('next');
      ctx.navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : `/u/${me().username}`);
    } catch (err) {
      showError(form, err);
      btn.disabled = false;
    }
  });
}

export async function registerView(ctx) {
  document.title = 'Crear cuenta · Visited Chile';
  if (me()) return ctx.navigate(`/u/${me().username}`, { replace: true });
  mount(ctx.root, html`
    <section class="auth">
      <h1>Crear cuenta</h1>
      <form class="card form" id="register-form" novalidate>
        <label class="field"><span>Nombre de usuario</span>
          <input name="username" autocomplete="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" autofocus>
          <small class="muted">3 a 20 caracteres: letras, números o _. Será tu perfil: /u/usuario</small></label>
        <label class="field"><span>Nombre para mostrar <small class="muted">(opcional)</small></span><input name="displayName" maxlength="40" autocomplete="name"></label>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Contraseña</span><input name="password" type="password" autocomplete="new-password" minlength="8" required>
          <small class="muted">Mínimo 8 caracteres.</small></label>
        <p class="form-error" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">Crear cuenta</button>
      </form>
      <p class="muted center">¿Ya tienes cuenta? <a href="/ingresar">Ingresa</a></p>
    </section>`);
  const form = $('#register-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await register({
        username: String(fd.get('username')).trim(),
        displayName: String(fd.get('displayName')).trim() || undefined,
        email: String(fd.get('email')).trim(),
        password: String(fd.get('password')),
      });
      toast('¡Cuenta creada! Empieza marcando los lugares que conoces.', 'ok', 4000);
      ctx.navigate(`/u/${me().username}`);
    } catch (err) {
      showError(form, err);
      btn.disabled = false;
    }
  });
}
