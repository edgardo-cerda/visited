import { html, mount, $ } from '../html.js';
import { api } from '../api.js';
import { me, logout, updateUser, forgetSession } from '../store.js';
import { toast, confirmDialog } from '../components.js';

export async function settingsView(ctx) {
  document.title = 'Ajustes · Visited Chile';
  const u = me();
  if (!u) return ctx.navigate('/ingresar?next=/ajustes', { replace: true });
  mount(ctx.root, html`
    <section class="page-head"><h1>Ajustes</h1></section>
    <div class="settings">
      <form class="card form" id="profile-form">
        <h2>Perfil</h2>
        <label class="field"><span>Nombre para mostrar</span><input name="displayName" maxlength="40" required value="${u.displayName}"></label>
        <label class="field"><span>Bio</span><textarea name="bio" rows="3" maxlength="500" placeholder="Viajero/a de…">${u.bio}</textarea></label>
        <p class="muted">Usuario: @${u.username} · Email: ${u.email}</p>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Guardar</button></div>
      </form>

      <form class="card form" id="password-form">
        <h2>Contraseña</h2>
        <label class="field"><span>Contraseña actual</span><input name="currentPassword" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>Nueva contraseña</span><input name="newPassword" type="password" autocomplete="new-password" minlength="8" required></label>
        <p class="form-error" hidden></p>
        <div class="form-actions"><button class="btn" type="submit">Cambiar contraseña</button></div>
      </form>

      <div class="card form">
        <h2>Sesión</h2>
        <div class="form-actions start"><button class="btn" id="logout">Cerrar sesión</button></div>
        <h2 class="danger-title">Zona peligrosa</h2>
        <p class="muted">Eliminar tu cuenta borra para siempre tus visitas, notas y reseñas.</p>
        <form id="delete-form" class="inline-form">
          <input name="password" type="password" placeholder="Tu contraseña" autocomplete="current-password" required>
          <button class="btn btn-danger" type="submit">Eliminar cuenta</button>
        </form>
      </div>
    </div>`);

  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { user } = await api('/me', { method: 'PATCH', body: { displayName: String(fd.get('displayName')), bio: String(fd.get('bio')) } });
      updateUser(user);
      toast('Perfil actualizado', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = $('.form-error', e.target);
    try {
      await api('/me/password', { method: 'POST', body: { currentPassword: String(fd.get('currentPassword')), newPassword: String(fd.get('newPassword')) } });
      e.target.reset();
      errBox.hidden = true;
      toast('Contraseña actualizada', 'ok');
    } catch (err) { errBox.hidden = false; errBox.textContent = err.message; }
  });

  $('#logout').addEventListener('click', async () => {
    await logout();
    ctx.navigate('/');
  });

  $('#delete-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = String(new FormData(e.target).get('password'));
    if (!(await confirmDialog('¿Seguro? Esta acción no se puede deshacer.', { ok: 'Eliminar mi cuenta' }))) return;
    try {
      await api('/me', { method: 'DELETE', body: { password } });
      forgetSession();
      toast('Cuenta eliminada');
      ctx.navigate('/');
    } catch (err) { toast(err.message, 'error'); }
  });
}
