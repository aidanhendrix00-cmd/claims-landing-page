// Cloudflare Worker: auth + tenant dashboard routing + signup/onboarding flow.
// Falls back to static assets (the marketing site) for everything else.

const SESSION_COOKIE = 'session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const NO_STORE = 'private, no-store, no-cache, must-revalidate';
const VERIFICATION_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const RESET_TTL_SECONDS = 60 * 60; // 1 hour
const NOTIFY_EMAIL = 'hndrx@claims-collection.net';
const SUPPORT_EMAIL = 'support@claims-collection.net';
const FROM_EMAIL = 'clAIms <info@claims-collection.net>';
const SITE_URL = 'https://claims-collection.net';

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','aol.com',
  'protonmail.com','live.com','msn.com','me.com','mail.com','gmx.com'
]);

const STRIPE_LINKS = {
  starter: 'https://buy.stripe.com/3cI9AM8I3a1j5Rnf5Zb7y00',
  growth: 'https://buy.stripe.com/dRm5kw2jF8Xf6Vr0b5b7y01',
  enterprise: null
};

const HELP_WIDGET_HTML = '<style>' +
  '#clms-help-btn{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#C29B57;color:#171717;border:none;box-shadow:0 10px 30px -8px rgba(23,23,23,0.45);cursor:pointer;font-family:"IBM Plex Sans",Arial,sans-serif;font-weight:700;font-size:22px;z-index:99999;display:flex;align-items:center;justify-content:center;transition:transform .15s ease, box-shadow .15s ease;line-height:1;}' +
  '#clms-help-btn:hover{transform:scale(1.06);box-shadow:0 14px 36px -8px rgba(23,23,23,0.55);}' +
  '#clms-help-panel{position:fixed;bottom:92px;right:24px;width:320px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #E5E0D2;border-radius:14px;box-shadow:0 24px 60px -20px rgba(23,23,23,0.35);z-index:99999;display:none;overflow:hidden;font-family:"IBM Plex Sans",Arial,sans-serif;}' +
  '#clms-help-panel.open{display:block;}' +
  '#clms-help-panel .chp-head{background:#171717;color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;}' +
  '#clms-help-panel .chp-head h4{margin:0;font-size:14px;font-weight:600;}' +
  '#clms-help-panel .chp-head span{display:block;font-size:10.5px;color:#DCC393;margin-top:3px;}' +
  '#clms-help-panel .chp-close{background:none;border:none;color:#D8D4C8;font-size:18px;cursor:pointer;line-height:1;padding:0;}' +
  '#clms-help-panel .chp-close:hover{color:#fff;}' +
  '#clms-help-panel .chp-body{padding:16px;}' +
  '#clms-help-panel input,#clms-help-panel textarea{width:100%;font-family:inherit;font-size:13px;color:#171717;border:1.5px solid #E5E0D2;border-radius:8px;padding:9px 11px;background:#FBFAF6;margin-bottom:10px;box-sizing:border-box;}' +
  '#clms-help-panel textarea{min-height:70px;resize:vertical;}' +
  '#clms-help-panel input:focus,#clms-help-panel textarea:focus{outline:none;border-color:#C29B57;}' +
  '#clms-help-panel button.chp-submit{width:100%;background:#171717;color:#fff;font-weight:600;font-size:13px;padding:10px;border:none;border-radius:8px;cursor:pointer;}' +
  '#clms-help-panel button.chp-submit:hover{opacity:.87;}' +
  '#clms-help-panel button.chp-submit:disabled{opacity:.6;cursor:default;}' +
  '#clms-help-panel .chp-note{font-size:11.5px;color:#615D53;margin-top:10px;line-height:1.5;}' +
  '#clms-help-panel .chp-status{display:none;padding:12px 15px;font-size:12.5px;border-radius:8px;margin-top:4px;line-height:1.5;}' +
  '#clms-help-panel .chp-status.ok{display:block;background:#DFEEE9;color:#1E5245;}' +
  '#clms-help-panel .chp-status.err{display:block;background:#F7E2DF;color:#6E3B3B;}' +
  '@media (max-width:420px){#clms-help-btn{bottom:16px;right:16px;}#clms-help-panel{right:16px;bottom:80px;}}' +
  '</style>' +
  '<button id="clms-help-btn" aria-label="Customer support and help" onclick="(function(){var p=document.getElementById(\'clms-help-panel\');p.classList.toggle(\'open\');})()">?</button>' +
  '<div id="clms-help-panel">' +
  '<div class="chp-head"><div><h4>Need help?</h4><span>We usually reply within one business day</span></div>' +
  '<button class="chp-close" aria-label="Close" onclick="document.getElementById(\'clms-help-panel\').classList.remove(\'open\')">&times;</button></div>' +
  '<div class="chp-body">' +
  '<form id="clms-help-form" onsubmit="return clmsSubmitHelp(event)">' +
  '<input type="text" id="chp-name" placeholder="Your name" autocomplete="name" required>' +
  '<input type="email" id="chp-email" placeholder="Your email" autocomplete="email" required>' +
  '<textarea id="chp-message" placeholder="How can we help?" required></textarea>' +
  '<button type="submit" class="chp-submit" id="chp-submit-btn">Send message</button>' +
  '</form>' +
  '<div class="chp-status" id="chp-status"></div>' +
  '<div class="chp-note">Or email us directly at <a href="mailto:help@claims-collection.net" style="color:#C29B57;font-weight:600;">help@claims-collection.net</a></div>' +
  '</div></div>' +
  '<script>' +
  'function clmsSubmitHelp(e){' +
  'e.preventDefault();' +
  'var btn=document.getElementById("chp-submit-btn");' +
  'var status=document.getElementById("chp-status");' +
  'status.className="chp-status";status.textContent="";' +
  'var name=document.getElementById("chp-name").value.trim();' +
  'var email=document.getElementById("chp-email").value.trim();' +
  'var message=document.getElementById("chp-message").value.trim();' +
  'if(!name||!email||!message){return false;}' +
  'btn.disabled=true;btn.textContent="Sending...";' +
  'fetch("/api/support",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name,email:email,message:message,page:location.href})})' +
  '.then(function(r){return r.json().then(function(d){return {ok:r.ok,data:d};});})' +
  '.then(function(res){' +
  'btn.disabled=false;btn.textContent="Send message";' +
  'if(res.ok&&res.data&&res.data.ok){' +
  'status.className="chp-status ok";' +
  'status.textContent="Thanks, "+name.split(" ")[0]+" — we got your message and will reply to "+email+" soon.";' +
  'document.getElementById("clms-help-form").reset();' +
  '}else{' +
  'status.className="chp-status err";' +
  'status.textContent=(res.data&&res.data.error)||"Something went wrong sending your message. Please email help@claims-collection.net directly.";' +
  '}' +
  '})' +
  '.catch(function(){' +
  'btn.disabled=false;btn.textContent="Send message";' +
  'status.className="chp-status err";' +
  'status.textContent="Network error — please email help@claims-collection.net directly.";' +
  '});' +
  'return false;' +
  '}' +
  '<' + '/script>';

const RESET_PASSWORD_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var resetView=document.getElementById("resetView");' +
  'var authCard=resetView?resetView.parentElement:null;' +
  'if(!resetView||!authCard){return;}' +
  'var resetNote=document.getElementById("resetNote");' +
  'if(resetNote){resetNote.innerHTML="";resetNote.classList.remove("show");}' +
  'var confirmView=document.createElement("div");' +
  'confirmView.id="clmsResetConfirmView";' +
  'confirmView.style.display="none";' +
  'confirmView.innerHTML=' +
  '\'<div class="auth-eyebrow">Reset Password</div>\'+' +
  '\'<h1>Choose a new password</h1>\'+' +
  '\'<p class="auth-sub">Enter a new password for your account.</p>\'+' +
  '\'<div class="auth-field"><label>New Password</label><input type="password" id="clms-rc-password" placeholder="At least 8 characters" autocomplete="new-password"></div>\'+' +
  '\'<div class="auth-field"><label>Confirm New Password</label><input type="password" id="clms-rc-confirm" placeholder="Re-enter new password" autocomplete="new-password"></div>\'+' +
  '\'<button class="btn-auth" id="clms-rc-submit">Set New Password</button>\'+' +
  '\'<div class="auth-note" id="clmsResetConfirmNote"></div>\';' +
  'authCard.appendChild(confirmView);' +
  'var resetToken=null;' +
  'try{var params=new URLSearchParams(location.search);resetToken=params.get("reset_token");}catch(e){}' +
  'function showConfirmView(){' +
  'var loginView=document.getElementById("loginView");' +
  'if(loginView){loginView.style.display="none";}' +
  'resetView.style.display="none";' +
  'confirmView.style.display="block";' +
  '}' +
  'function backToLogin(){' +
  'confirmView.style.display="none";' +
  'resetView.style.display="none";' +
  'var loginView=document.getElementById("loginView");' +
  'if(loginView){loginView.style.display="block";}' +
  '}' +
  'document.getElementById("clms-rc-submit").addEventListener("click",function(){' +
  'var password=document.getElementById("clms-rc-password").value;' +
  'var confirmPassword=document.getElementById("clms-rc-confirm").value;' +
  'var note=document.getElementById("clmsResetConfirmNote");' +
  'note.classList.add("show");' +
  'if(!password||password.length<8){note.textContent="Password must be at least 8 characters.";return;}' +
  'if(password!==confirmPassword){note.textContent="Passwords do not match.";return;}' +
  'if(!resetToken){note.textContent="This reset link is missing its token. Please use the link from your email.";return;}' +
  'var btn=document.getElementById("clms-rc-submit");' +
  'btn.disabled=true;' +
  'note.textContent="Updating your password...";' +
  'fetch("/api/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:resetToken,password:password,confirmPassword:confirmPassword})})' +
  '.then(function(r){return r.json().then(function(d){return {ok:r.ok,data:d};});})' +
  '.then(function(res){' +
  'btn.disabled=false;' +
  'if(res.ok&&res.data&&res.data.ok){' +
  'note.textContent="Password updated — you can log in now.";' +
  'document.getElementById("clms-rc-password").value="";' +
  'document.getElementById("clms-rc-confirm").value="";' +
  'setTimeout(backToLogin,1800);' +
  '}else{' +
  'note.textContent=(res.data&&res.data.error)||"That reset link is invalid or expired.";' +
  '}' +
  '})' +
  '.catch(function(){' +
  'btn.disabled=false;' +
  'note.textContent="Something went wrong. Please try again.";' +
  '});' +
  '});' +
  'window.submitAuthReset=function(){' +
  'var emailInput=document.getElementById("reset-email");' +
  'var email=emailInput?emailInput.value.trim():"";' +
  'var note=document.getElementById("resetNote");' +
  'note.classList.add("show");' +
  'if(!email){note.textContent="Please enter your email address.";return;}' +
  'note.textContent="Sending reset link...";' +
  'fetch("/api/forgot-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email})})' +
  '.then(function(r){return r.json();})' +
  '.then(function(d){' +
  'note.textContent=(d&&d.message)||"If an account exists for that email, we\'ve sent a reset link.";' +
  '})' +
  '.catch(function(){' +
  'note.textContent="Something went wrong. Please try again.";' +
  '});' +
  '};' +
  'if(resetToken){' +
  'if(typeof navigateToOverlay==="function"){navigateToOverlay("#login");}' +
  'else{var overlay=document.getElementById("loginOverlay");if(overlay){overlay.classList.add("open");}}' +
  'showConfirmView();' +
  '}' +
  '});' +
  '})();' +
  '<' + '/script>';

const DEMO_FIX_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var frame=document.getElementById("dashboardFrame");' +
  'if(!frame){return;}' +
  'var loaded=false;' +
  'window.loadDemoIfNeeded=function(){' +
  'if(loaded){return;}' +
  'loaded=true;' +
  'var loading=document.getElementById("demoLoading");' +
  'fetch("/api/demo-dashboard").then(function(r){' +
  'if(!r.ok){throw new Error("bad status");}' +
  'return r.text();' +
  '}).then(function(html){' +
  'frame.srcdoc=html;' +
  'frame.addEventListener("load",function(){' +
  'if(loading){loading.classList.add("hide");}' +
  '},{once:true});' +
  '}).catch(function(){' +
  'loaded=false;' +
  'if(loading){loading.textContent="Couldn\'t load the demo right now — please try again shortly.";}' +
  '});' +
  '};' +
  'if(location.hash==="#demo"){window.loadDemoIfNeeded();}' +
  '});' +
  '})();' +
  '<' + '/script>';

const PROCESS_EXPLAINER_HTML = '<div class="clms-process-explainer">' +
  '<div class="section-head" style="margin-bottom:36px;">' +
  '<h2 style="font-size:26px;">From sign-up to a working dashboard</h2>' +
  '<p>Here\'s exactly what happens after you click Get Started.</p>' +
  '</div>' +
  '<div class="steps-row" style="margin-bottom:56px;">' +
  '<div class="step-card">' +
  '<div class="step-num">1</div>' +
  '<h3>Create Your Account</h3>' +
  '<p>Sign up using your company\'s work domain email so we can verify your business and connect you with your team.</p>' +
  '</div>' +
  '<div class="step-card">' +
  '<div class="step-num">2</div>' +
  '<h3>Submit Payment</h3>' +
  '<p>Choose the plan that fits your AR volume and submit payment to activate your account.</p>' +
  '</div>' +
  '<div class="step-card">' +
  '<div class="step-num">3</div>' +
  '<h3>Implementation Period</h3>' +
  '<p>Our team configures your offices, departments, and integrations during a short onboarding window.</p>' +
  '</div>' +
  '<div class="step-card">' +
  '<div class="step-num">4</div>' +
  '<h3>Log In &amp; Get Results</h3>' +
  '<p>Receive your clAIms login and dashboard access, then watch your outstanding AR start moving.</p>' +
  '</div>' +
  '</div>' +
  '</div>';

const CONTACT_FORM_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var headerBtns=document.querySelectorAll(\'a.btn-header-primary[href="#contact"]\');' +
  'for(var i=0;i<headerBtns.length;i++){headerBtns[i].textContent="Contact Us";}' +
  'var card=document.querySelector(".contact-card");' +
  'if(!card){return;}' +
  'card.innerHTML=' +
  '\'<div class="c-field">\'+' +
  '\'<label>Full Name</label>\'+' +
  '\'<input type="text" id="c-name" placeholder="Jane Smith">\'+' +
  '\'</div>\'+' +
  '\'<div class="c-field">\'+' +
  '\'<label>Work Email</label>\'+' +
  '\'<input type="email" id="c-email" placeholder="jane@yourcompany.com">\'+' +
  '\'</div>\'+' +
  '\'<div class="c-field">\'+' +
  '\'<label>Company</label>\'+' +
  '\'<input type="text" id="c-company" placeholder="Your Company Name">\'+' +
  '\'</div>\'+' +
  '\'<div class="c-field">\'+' +
  '\'<label>What can we help you with?</label>\'+' +
  '\'<select id="c-help-topic">\'+' +
  '\'<option value="login">Login help</option>\'+' +
  '\'<option value="account">Account help</option>\'+' +
  '\'<option value="status">Check status of my account set up</option>\'+' +
  '\'<option value="other">Other</option>\'+' +
  '\'</select>\'+' +
  '\'</div>\'+' +
  '\'<div class="c-field" id="c-help-other-wrap" style="display:none;">\'+' +
  '\'<label>Please tell us more</label>\'+' +
  '\'<textarea id="c-help-other" placeholder="Tell us what you need help with..."></textarea>\'+' +
  '\'</div>\'+' +
  '\'<div class="c-field">\'+' +
  '\'<label>Anything you\\\'d like us to know? <span style="text-transform:none;font-weight:400;">(optional)</span></label>\'+' +
  '\'<textarea id="c-message" placeholder="Anything else we should know..."></textarea>\'+' +
  '\'</div>\'+' +
  '\'<button class="btn-primary contact-submit" onclick="submitContact()">Send inquiry →</button>\'+' +
  '\'<div class="contact-note">This opens your email client with these details filled in, addressed to <b id="contactEmailDisplay">salesnmarketing@claims-collection.net</b>.</div>\';' +
  'var topicSelect=document.getElementById("c-help-topic");' +
  'var otherWrap=document.getElementById("c-help-other-wrap");' +
  'function syncOther(){otherWrap.style.display=(topicSelect.value==="other")?"block":"none";}' +
  'topicSelect.addEventListener("change",syncOther);' +
  'syncOther();' +
  'var TOPIC_LABELS={login:"Login help",account:"Account help",status:"Check status of my account set up",other:"Other"};' +
  'window.submitContact=function(){' +
  'var name=document.getElementById("c-name").value.trim();' +
  'var email=document.getElementById("c-email").value.trim();' +
  'var company=document.getElementById("c-company").value.trim();' +
  'var topic=document.getElementById("c-help-topic").value;' +
  'var otherEl=document.getElementById("c-help-other");' +
  'var otherDetail=otherEl?otherEl.value.trim():"";' +
  'var messageEl=document.getElementById("c-message");' +
  'var message=messageEl?messageEl.value.trim():"";' +
  'if(!name||!email){alert("Please enter your name and work email so we know who to follow up with.");return;}' +
  'var topicLabel=TOPIC_LABELS[topic]||topic;' +
  'var subject="New inquiry — "+topicLabel+" — "+(company||name);' +
  'var bodyLines=["Name: "+name,"Email: "+email,"Company: "+(company||"(not provided)"),"What can we help with: "+topicLabel];' +
  'if(topic==="other"&&otherDetail){bodyLines.push("Details: "+otherDetail);}' +
  'bodyLines.push("");' +
  'bodyLines.push("Anything else: "+(message||"(none)"));' +
  'var body=bodyLines.join("\\n");' +
  'var contactEmail="salesnmarketing@claims-collection.net";' +
  'try{if(typeof CONTACT_EMAIL!=="undefined"&&CONTACT_EMAIL){contactEmail=CONTACT_EMAIL;}}catch(e){}' +
  'var mailto="mailto:"+contactEmail+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);' +
  'window.location.href=mailto;' +
  '};' +
  '});' +
  '})();' +
  '<' + '/script>';

const GET_STARTED_FORM_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var headerBtns=document.querySelectorAll(\'[onclick="openSignup()"]\');' +
  'for(var i=0;i<headerBtns.length;i++){headerBtns[i].textContent="Get Started";}' +
  'var eyebrow=document.querySelector("#signupOverlay .auth-eyebrow");' +
  'if(eyebrow){eyebrow.textContent="Get Started";}' +
  'var formFields=document.getElementById("signupFormFields");' +
  'if(!formFields){return;}' +
  'var pwField=document.getElementById("su-password");' +
  'if(pwField){var pwWrap=pwField.closest(".auth-field");if(pwWrap&&pwWrap.parentNode){pwWrap.parentNode.removeChild(pwWrap);}}' +
  'var cpwField=document.getElementById("su-confirm-password");' +
  'if(cpwField){var cpwWrap=cpwField.closest(".auth-field");if(cpwWrap&&cpwWrap.parentNode){cpwWrap.parentNode.removeChild(cpwWrap);}}' +
  'var sizeField=document.getElementById("su-size");' +
  'var sizeWrap=sizeField?sizeField.closest(".auth-field"):null;' +
  'var planWrap=document.createElement("div");' +
  'planWrap.className="auth-field";' +
  'planWrap.innerHTML=' +
  '\'<label>Desired Plan</label>\'+' +
  '\'<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px;">\'+' +
  '\'<label style="display:flex;align-items:center;gap:6px;font-weight:400;text-transform:none;letter-spacing:0;font-size:14px;"><input type="radio" name="su-plan-choice" value="starter" style="width:auto;">Starter</label>\'+' +
  '\'<label style="display:flex;align-items:center;gap:6px;font-weight:400;text-transform:none;letter-spacing:0;font-size:14px;"><input type="radio" name="su-plan-choice" value="growth" style="width:auto;">Growth</label>\'+' +
  '\'<label style="display:flex;align-items:center;gap:6px;font-weight:400;text-transform:none;letter-spacing:0;font-size:14px;"><input type="radio" name="su-plan-choice" value="enterprise" style="width:auto;">Enterprise</label>\'+' +
  '\'</div>\';' +
  'if(sizeWrap&&sizeWrap.parentNode){sizeWrap.parentNode.insertBefore(planWrap,sizeWrap.nextSibling);}else{formFields.appendChild(planWrap);}' +
  'var submitBtn=document.getElementById("su-submit-btn");' +
  'if(!submitBtn){return;}' +
  'submitBtn.textContent="Get Started";' +
  'submitBtn.style.display="none";' +
  'function fieldVal(id){var el=document.getElementById(id);return el?el.value.trim():"";}' +
  'function checkComplete(){' +
  'var complete=!!(' +
  'fieldVal("su-fullname")&&' +
  'fieldVal("su-email")&&' +
  'fieldVal("su-company")&&' +
  'fieldVal("su-address")&&' +
  'fieldVal("su-city")&&' +
  'fieldVal("su-state")&&' +
  'fieldVal("su-zip")&&' +
  'fieldVal("su-size")&&' +
  'document.querySelector(\'input[name="su-plan-choice"]:checked\')&&' +
  '(document.getElementById("su-terms")&&document.getElementById("su-terms").checked)' +
  ');' +
  'submitBtn.style.display=complete?"inline-block":"none";' +
  '}' +
  'formFields.addEventListener("input",checkComplete);' +
  'formFields.addEventListener("change",checkComplete);' +
  'checkComplete();' +
  'window.submitSignup=function(){' +
  'var note=document.getElementById("signupNote");' +
  'var planEl=document.querySelector(\'input[name="su-plan-choice"]:checked\');' +
  'var payload={' +
  'fullName:fieldVal("su-fullname"),' +
  'email:fieldVal("su-email"),' +
  'companyName:fieldVal("su-company"),' +
  'address:fieldVal("su-address"),' +
  'city:fieldVal("su-city"),' +
  'state:fieldVal("su-state"),' +
  'zip:fieldVal("su-zip"),' +
  'companySize:fieldVal("su-size"),' +
  'desiredPlan:planEl?planEl.value:"",' +
  'agreeToTerms:(document.getElementById("su-terms")?document.getElementById("su-terms").checked:false)' +
  '};' +
  'if(!payload.fullName||!payload.email||!payload.companyName||!payload.desiredPlan||!payload.agreeToTerms){' +
  'if(note){note.classList.add("show");note.textContent="Please complete all fields and agree to the Terms & Conditions.";}' +
  'return;' +
  '}' +
  'submitBtn.disabled=true;submitBtn.textContent="Submitting...";' +
  'fetch("/api/get-started",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})' +
  '.then(function(r){return r.json().then(function(d){return {ok:r.ok,data:d};});})' +
  '.then(function(res){' +
  'if(res.ok&&res.data&&res.data.ok){' +
  'window.location.href="/thank-you";' +
  '}else{' +
  'submitBtn.disabled=false;submitBtn.textContent="Get Started";' +
  'if(note){note.classList.add("show");note.textContent=(res.data&&res.data.error)||"Something went wrong. Please try again.";}' +
  '}' +
  '})' +
  '.catch(function(){' +
  'submitBtn.disabled=false;submitBtn.textContent="Get Started";' +
  'if(note){note.classList.add("show");note.textContent="Network error. Please try again.";}' +
  '});' +
  '};' +
  '});' +
  '})();' +
  '<' + '/script>';

const THANK_YOU_HTML = '<!doctype html><html lang="en"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Thank you — clAIms</title>' +
  '<link rel="icon" href="/favicon.ico">' +
  '<style>' +
  'body{margin:0;font-family:"IBM Plex Sans",Arial,sans-serif;background:#F5F2EA;color:#171717;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box;}' +
  '.ty-card{background:#fff;border:1px solid #E5E0D2;border-radius:16px;padding:48px 40px;max-width:520px;text-align:center;box-shadow:0 24px 60px -20px rgba(23,23,23,0.15);}' +
  '.ty-card .ty-mark{font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C29B57;margin-bottom:18px;}' +
  '.ty-card h1{font-size:26px;margin:0 0 16px;}' +
  '.ty-card p{font-size:15px;line-height:1.6;color:#3B3A35;margin:0 0 28px;}' +
  '.ty-card a{display:inline-block;background:#171717;color:#fff;text-decoration:none;font-weight:600;padding:12px 26px;border-radius:8px;}' +
  '.ty-card a:hover{opacity:.88;}' +
  '</style></head><body>' +
  '<div class="ty-card">' +
  '<div class="ty-mark">clAIms</div>' +
  '<h1>Thank you for your submission!</h1>' +
  '<p>Please allow adequate time for the clAIms collection team to reach out to you to begin the setup process.</p>' +
  '<a href="/">Back to home</a>' +
  '</div>' +
  '</body></html>';

const ACCOUNT_PAGE_HTML = '<!doctype html><html lang="en"><head><meta charset="UTF-8"> ' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"> ' +
  '<title>My Account — clAIms</title> ' +
  '<link rel="icon" href="/favicon.ico"> ' +
  '<style> ' +
  '*{box-sizing:border-box;} ' +
  'body{margin:0;font-family:"IBM Plex Sans",Arial,sans-serif;background:#F5F2EA;color:#171717;} ' +
  '.acct-topbar{background:#171717;color:#fff;padding:16px 28px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;} ' +
  '.acct-brand{font-weight:700;font-size:18px;letter-spacing:.02em;} ' +
  '.acct-topbar-right{display:flex;align-items:center;gap:16px;flex-wrap:wrap;} ' +
  '.acct-user-chip{font-size:13px;color:#D8D4C8;} ' +
  '.acct-user-chip b{color:#fff;} ' +
  '.acct-role-badge{display:inline-block;margin-left:8px;padding:2px 9px;border-radius:20px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;} ' +
  '.acct-role-badge.admin{background:#C29B57;color:#171717;} ' +
  '.acct-role-badge.manager{background:#3E5C8A;color:#fff;} ' +
  '.acct-role-badge.employee{background:#4A4A46;color:#fff;} ' +
  '.btn-to-dashboard{display:inline-flex;align-items:center;gap:8px;background:#C29B57;color:#171717;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;box-shadow:0 8px 22px -6px rgba(194,155,87,0.65);transition:transform .15s ease, box-shadow .15s ease;white-space:nowrap;} ' +
  '.btn-to-dashboard:hover{transform:translateY(-1px);box-shadow:0 12px 28px -6px rgba(194,155,87,0.8);} ' +
  '.acct-wrap{max-width:1080px;margin:0 auto;padding:28px 24px 80px;} ' +
  '.acct-tabs{display:flex;gap:4px;border-bottom:1px solid #E5E0D2;margin-bottom:24px;overflow-x:auto;} ' +
  '.acct-tab{background:none;border:none;font-family:inherit;font-size:14px;font-weight:600;color:#615D53;padding:12px 18px;cursor:pointer;border-bottom:3px solid transparent;white-space:nowrap;} ' +
  '.acct-tab:hover{color:#171717;} ' +
  '.acct-tab.active{color:#171717;border-bottom-color:#C29B57;} ' +
  '.acct-panel{display:none;} ' +
  '.acct-panel.active{display:block;} ' +
  '.acct-card{background:#fff;border:1px solid #E5E0D2;border-radius:14px;padding:22px 24px;margin-bottom:18px;box-shadow:0 12px 30px -18px rgba(23,23,23,0.15);} ' +
  '.acct-card h3{margin:0 0 4px;font-size:16px;} ' +
  '.acct-card .acct-card-sub{font-size:12.5px;color:#615D53;margin-bottom:16px;} ' +
  '.acct-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 24px;} ' +
  '@media (max-width:640px){.acct-grid{grid-template-columns:1fr;}} ' +
  '.acct-field label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8A8578;font-weight:700;margin-bottom:5px;} ' +
  '.acct-field .acct-value{font-size:14.5px;color:#171717;padding:9px 0;border-bottom:1px solid #F0EDE3;} ' +
  '.btn-dark{background:#171717;color:#fff;border:none;font-weight:600;font-size:13px;padding:10px 18px;border-radius:8px;cursor:pointer;} ' +
  '.btn-dark:hover{opacity:.88;} ' +
  '.btn-outline{background:none;color:#171717;border:1.5px solid #E5E0D2;font-weight:600;font-size:13px;padding:9px 17px;border-radius:8px;cursor:pointer;} ' +
  '.btn-outline:hover{border-color:#C29B57;color:#C29B57;} ' +
  '.btn-sm{font-size:12px;padding:6px 12px;border-radius:7px;} ' +
  '.restricted-box{background:#FBFAF6;border:1px dashed #E5E0D2;border-radius:12px;padding:32px 24px;text-align:center;color:#8A8578;font-size:13.5px;line-height:1.6;} ' +
  '.restricted-box b{color:#3B3A35;} ' +
  '.plan-banner{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;background:#171717;color:#fff;border-radius:14px;padding:18px 22px;margin-bottom:18px;} ' +
  '.plan-banner .plan-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#C29B57;font-weight:700;margin-bottom:4px;} ' +
  '.plan-banner .plan-name{font-size:18px;font-weight:700;} ' +
  '.plan-feature-list{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;} ' +
  '.plan-feature-list li{font-size:13px;color:#3B3A35;padding-left:20px;position:relative;} ' +
  '.plan-feature-list li:before{content:"✓";position:absolute;left:0;color:#C29B57;font-weight:700;} ' +
  '@media (max-width:640px){.plan-feature-list{grid-template-columns:1fr;}} ' +
  'table.acct-table{width:100%;border-collapse:collapse;font-size:13.5px;} ' +
  'table.acct-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8A8578;font-weight:700;padding:10px 12px;border-bottom:1.5px solid #E5E0D2;} ' +
  'table.acct-table td{padding:12px 12px;border-bottom:1px solid #F0EDE3;vertical-align:middle;} ' +
  'table.acct-table tr:last-child td{border-bottom:none;} ' +
  '.filters-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;} ' +
  '.filters-row select{font-family:inherit;font-size:13px;padding:9px 12px;border:1.5px solid #E5E0D2;border-radius:8px;background:#fff;color:#171717;} ' +
  '.team-name-cell{display:flex;align-items:center;gap:10px;} ' +
  '.team-avatar{width:32px;height:32px;border-radius:50%;background:#F0EDE3;color:#615D53;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;} ' +
  '.role-pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;} ' +
  '.role-pill.admin{background:#F3E7D2;color:#8A6A2F;} ' +
  '.role-pill.manager{background:#DCE6F5;color:#2F4E80;} ' +
  '.role-pill.employee{background:#EAE8E1;color:#57544B;} ' +
  '.section-divider{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8A8578;font-weight:700;padding:16px 12px 6px;} ' +
  '.perm-matrix{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;} ' +
  '.perm-matrix th,.perm-matrix td{padding:9px 10px;border-bottom:1px solid #F0EDE3;text-align:left;} ' +
  '.perm-matrix th{color:#8A8578;font-size:11px;text-transform:uppercase;letter-spacing:.04em;} ' +
  '.perm-yes{color:#1E5245;font-weight:700;} ' +
  '.perm-no{color:#B7B2A4;} ' +
  '.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #F0EDE3;gap:16px;} ' +
  '.toggle-row:last-child{border-bottom:none;} ' +
  '.toggle-row .toggle-label{font-size:13.5px;color:#171717;font-weight:600;} ' +
  '.toggle-row .toggle-sub{font-size:12px;color:#8A8578;margin-top:2px;} ' +
  '.switch{position:relative;width:40px;height:22px;flex-shrink:0;} ' +
  '.switch input{opacity:0;width:0;height:0;} ' +
  '.switch .slider{position:absolute;inset:0;background:#E5E0D2;border-radius:22px;transition:.15s;cursor:pointer;} ' +
  '.switch .slider:before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.15s;} ' +
  '.switch input:checked + .slider{background:#C29B57;} ' +
  '.switch input:checked + .slider:before{transform:translateX(18px);} ' +
  '.loading-state{padding:60px 20px;text-align:center;color:#8A8578;font-size:14px;} ' +
  '.edit-modal-backdrop{position:fixed;inset:0;background:rgba(23,23,23,0.55);display:none;align-items:center;justify-content:center;z-index:999;padding:20px;} ' +
  '.edit-modal-backdrop.open{display:flex;} ' +
  '.edit-modal{background:#fff;border-radius:14px;padding:26px;max-width:420px;width:100%;} ' +
  '.edit-modal h4{margin:0 0 16px;} ' +
  '.edit-modal .acct-field{margin-bottom:14px;} ' +
  '.edit-modal select,.edit-modal input{width:100%;font-family:inherit;font-size:14px;padding:9px 11px;border:1.5px solid #E5E0D2;border-radius:8px;} ' +
  '.edit-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;} ' +
  '.mock-flag{display:inline-block;font-size:10px;color:#B08A3E;background:#FBF3E4;border:1px solid #EEDDB6;padding:2px 8px;border-radius:6px;margin-left:8px;font-weight:600;vertical-align:middle;} ' +
  '.freq-day-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:14px;} ' +
  '@media (max-width:640px){.freq-day-grid{grid-template-columns:repeat(4,1fr);}} ' +
  '.freq-day-chip{border:1.5px solid #E5E0D2;border-radius:8px;padding:8px 4px;text-align:center;font-size:11.5px;font-weight:600;color:#8A8578;cursor:pointer;background:#FBFAF6;user-select:none;} ' +
  '.freq-day-chip .freq-day-num{display:block;font-size:13px;font-weight:700;color:#171717;margin-bottom:2px;} ' +
  '.freq-day-chip.on{background:#FBF3E4;border-color:#C29B57;color:#8A6A2F;} ' +
  '.freq-day-chip.on .freq-day-num{color:#171717;} ' +
  '.freq-day-chip.readonly{cursor:default;} ' +
  '.freq-legend{display:flex;gap:18px;margin-top:12px;font-size:11.5px;color:#8A8578;} ' +
  '.freq-legend span{display:inline-flex;align-items:center;gap:6px;} ' +
  '.freq-legend .dot{width:10px;height:10px;border-radius:3px;display:inline-block;} ' +
  '.freq-legend .dot.on{background:#C29B57;} ' +
  '.freq-legend .dot.off{background:#E5E0D2;} ' +
  '.freq-inline-field{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;} ' +
  '.freq-inline-field label{font-size:12.5px;color:#615D53;} ' +
  '.freq-inline-field input[type=number]{width:70px;font-family:inherit;font-size:13px;padding:7px 9px;border:1.5px solid #E5E0D2;border-radius:7px;} ' +
  '.freq-inline-field input[type=time]{font-family:inherit;font-size:13px;padding:7px 9px;border:1.5px solid #E5E0D2;border-radius:7px;} ' +
  '.freq-inline-field select{font-family:inherit;font-size:13px;padding:7px 9px;border:1.5px solid #E5E0D2;border-radius:7px;} ' +
  '.freq-note{font-size:12px;color:#615D53;background:#F5F2EA;border-radius:8px;padding:10px 12px;margin-top:12px;line-height:1.5;} ' +
  '</style></head> ' +
  '<body> ' +
  '<div class="acct-topbar"> ' +
  '<div class="acct-brand">clAIms</div> ' +
  '<div class="acct-topbar-right"> ' +
  '<div class="acct-user-chip" id="acctUserChip">Loading account…</div> ' +
  '<a href="/dashboard" class="btn-to-dashboard" id="toDashboardBtn">To my Dashboard →</a> ' +
  '</div> ' +
  '</div> ' +
  ' ' +
  '<div class="acct-wrap"> ' +
  '<div class="acct-tabs" id="acctTabs"> ' +
  '<button class="acct-tab active" data-tab="account">Account</button> ' +
  '<button class="acct-tab" data-tab="billing">Payment &amp; Billing</button> ' +
  '<button class="acct-tab" data-tab="team">My Team</button> ' +
  '<button class="acct-tab" data-tab="frequency">Contact Frequency</button> ' +
  '<button class="acct-tab" data-tab="settings">Settings &amp; Permissions</button> ' +
  '</div> ' +
  ' ' +
  '<div id="acctLoading" class="loading-state">Loading your account…</div> ' +
  ' ' +
  '<div id="acctPanels" style="display:none;"> ' +
  ' ' +
  '<div class="acct-panel active" id="panel-account"> ' +
  '<div class="acct-card"> ' +
  '<h3>Account information</h3> ' +
  '<div class="acct-card-sub">Your login and profile details.</div> ' +
  '<div class="acct-grid"> ' +
  '<div class="acct-field"><label>Full name</label><div class="acct-value" id="acctFullName">—</div></div> ' +
  '<div class="acct-field"><label>Username / Email</label><div class="acct-value" id="acctEmail">—</div></div> ' +
  '<div class="acct-field"><label>Company</label><div class="acct-value" id="acctCompany">—</div></div> ' +
  '<div class="acct-field"><label>Account type</label><div class="acct-value" id="acctRoleValue">—</div></div> ' +
  '<div class="acct-field"><label>Password</label><div class="acct-value">••••••••••• <a href="/#login" onclick="location.hash=\'login\';" style="color:#C29B57;font-weight:600;text-decoration:none;font-size:12.5px;">Change password</a></div></div> ' +
  '<div class="acct-field"><label>Member since</label><div class="acct-value" id="acctJoined">—<span class="mock-flag">sample</span></div></div> ' +
  '</div> ' +
  '</div> ' +
  '</div> ' +
  ' ' +
  '<div class="acct-panel" id="panel-billing"> ' +
  '<div id="billingRestricted" class="restricted-box" style="display:none;">Payment &amp; Billing is available to <b>managers</b> and <b>admins</b>. Contact your company admin if you need access.</div> ' +
  '<div id="billingContent" style="display:none;"> ' +
  '<div class="plan-banner"> ' +
  '<div> ' +
  '<div class="plan-label">Current plan</div> ' +
  '<div class="plan-name" id="billingPlanName">—</div> ' +
  '</div> ' +
  '<button class="btn-dark btn-sm" id="manageSubBtn" onclick="window.location.href=\'/account/subscription\'">Manage Subscription</button> ' +
  '</div> ' +
  '<div class="acct-card"> ' +
  '<h3>Plan features<span class="mock-flag">sample</span></h3> ' +
  '<ul class="plan-feature-list" id="planFeatureList"></ul> ' +
  '</div> ' +
  '<div class="acct-card"> ' +
  '<h3>Payment method<span class="mock-flag">sample</span></h3> ' +
  '<div class="acct-grid"> ' +
  '<div class="acct-field"><label>Card on file</label><div class="acct-value">Visa •••• 4242, exp 08/28</div></div> ' +
  '<div class="acct-field"><label>Business address</label><div class="acct-value" id="billingAddress">—</div></div> ' +
  '</div> ' +
  '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;" id="billingAdminActions"> ' +
  '<button class="btn-outline btn-sm">Update payment method</button> ' +
  '</div> ' +
  '</div> ' +
  '<div class="acct-card"> ' +
  '<h3>Transaction history<span class="mock-flag">sample</span></h3> ' +
  '<table class="acct-table"> ' +
  '<thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead> ' +
  '<tbody id="billingTxRows"></tbody> ' +
  '</table> ' +
  '<div style="margin-top:14px;" id="billingManagerActions"> ' +
  '<button class="btn-outline btn-sm">Apply a payment</button> ' +
  '</div> ' +
  '</div> ' +
  '</div> ' +
  '</div> ' +
  ' ' +
  '<div class="acct-panel" id="panel-team"> ' +
  '<div class="acct-card"> ' +
  '<h3>My Team<span class="mock-flag">sample data</span></h3> ' +
  '<div class="acct-card-sub">Everyone at your company with a clAIms account.</div> ' +
  '<div class="filters-row"> ' +
  '<select id="filterOffice"><option value="">All offices</option></select> ' +
  '<select id="filterDept"><option value="">All departments</option></select> ' +
  '<select id="filterType"><option value="">All account types</option><option value="admin">Admin</option><option value="manager">Manager</option><option value="employee">Employee</option></select> ' +
  '</div> ' +
  '<table class="acct-table"> ' +
  '<thead><tr> ' +
  '<th>Name</th><th>Email</th><th>Department</th><th>Office</th><th>Account type</th><th id="teamCredHeader" style="display:none;">Credentials</th><th id="teamEditHeader" style="display:none;">Actions</th> ' +
  '</tr></thead> ' +
  '<tbody id="teamRows"></tbody> ' +
  '</table> ' +
  '</div> ' +
  '</div> ' +
  ' ' +
  '<div class="acct-panel" id="panel-frequency"> ' +
  '<div class="acct-card"> ' +
  '<h3>Follow-up cadence (Day 1&ndash;30)<span class="mock-flag">sample</span></h3> ' +
  '<div class="acct-card-sub">Choose which days after Day 1 your automated follow-ups go out. Turn any day off to create a quiet period.</div> ' +
  '<div class="freq-day-grid" id="freqDayGrid"></div> ' +
  '<div class="freq-legend"><span><span class="dot on"></span>Follow-up scheduled</span><span><span class="dot off"></span>Automation off</span></div> ' +
  '</div> ' +
  ' ' +
  '<div class="acct-card"> ' +
  '<h3>Notice of Intent to Lien (NOIL)</h3> ' +
  '<div class="acct-card-sub">Draft a NOIL for review once an invoice reaches a set age.</div> ' +
  '<div class="toggle-row"><div><div class="toggle-label">Enable NOIL automation</div><div class="toggle-sub">clAIms drafts a NOIL for review; nothing sends without your approval.</div></div><label class="switch"><input type="checkbox" id="noilEnabled"><span class="slider"></span></label></div> ' +
  '<div class="freq-inline-field"><label for="noilDay">Draft NOIL on day</label><input type="number" id="noilDay" min="1" max="120"><span style="font-size:12.5px;color:#615D53;">since Day 1</span></div> ' +
  '</div> ' +
  ' ' +
  '<div class="acct-card"> ' +
  '<h3>Demand Letter</h3> ' +
  '<div class="acct-card-sub">Draft a formal demand letter for review once an invoice reaches a set age.</div> ' +
  '<div class="toggle-row"><div><div class="toggle-label">Enable Demand Letter automation</div><div class="toggle-sub">clAIms drafts a demand letter for review; nothing sends without your approval.</div></div><label class="switch"><input type="checkbox" id="demandEnabled"><span class="slider"></span></label></div> ' +
  '<div class="freq-inline-field"><label for="demandDay">Draft demand letter on day</label><input type="number" id="demandDay" min="1" max="120"><span style="font-size:12.5px;color:#615D53;">since Day 1</span></div> ' +
  '</div> ' +
  ' ' +
  '<div class="acct-card"> ' +
  '<h3>Guardrails<span class="mock-flag">sample</span></h3> ' +
  '<div class="acct-card-sub">Limits that keep automation respectful of customers, regardless of the cadence configured above.</div> ' +
  '<div class="freq-inline-field"><label>Quiet hours &mdash; no sends between</label><input type="time" id="quietStart"><span style="font-size:12.5px;color:#615D53;">and</span><input type="time" id="quietEnd"></div> ' +
  '<div class="freq-inline-field"><label for="maxPerWeek">Maximum automated contacts per customer, per week</label><input type="number" id="maxPerWeek" min="1" max="14"></div> ' +
  '<div class="toggle-row"><div><div class="toggle-label">Escalate to a human</div><div class="toggle-sub">Hand a customer off to a teammate after repeated unanswered contact.</div></div><label class="switch"><input type="checkbox" id="escalateEnabled"><span class="slider"></span></label></div> ' +
  '<div class="freq-inline-field"><label for="escalateAfter">Escalate after</label><input type="number" id="escalateAfter" min="1" max="10"><span style="font-size:12.5px;color:#615D53;">unanswered follow-ups, assign to</span><select id="escalateAssignee"></select></div> ' +
  '<div class="freq-note">Every automated message includes a one-click opt-out. Customers who opt out are removed from all future automation immediately and flagged here for manual follow-up. This cannot be overridden by the cadence settings above.</div> ' +
  '</div> ' +
  ' ' +
  '<div class="acct-card"> ' +
  '<h3>Messaging identity</h3> ' +
  '<div class="acct-card-sub">What customers see when a message arrives.</div> ' +
  '<div class="acct-field"><label>Sender name</label><input type="text" id="senderName" style="width:100%;font-family:inherit;font-size:14.5px;padding:9px 11px;border:1.5px solid #E5E0D2;border-radius:8px;"></div> ' +
  '<div class="freq-note">Every follow-up, NOIL, and demand letter is sent and signed as your company. Customers never see the clAIms platform name in a message as the signature in the footnote.</div> ' +
  '</div> ' +
  ' ' +
  '<div id="freqSavedNote" style="display:none;font-size:12.5px;color:#1E5245;margin-bottom:14px;">&#10003; Saved</div> ' +
  '<div id="freqActions" style="display:flex;justify-content:flex-end;"><button class="btn-dark" id="freqSaveBtn">Save changes</button></div> ' +
  '<div id="freqReadonlyNote" class="restricted-box" style="display:none;">Only admins can change contact frequency and guardrails. Below is the current configuration for your company.</div> ' +
  '</div> ' +
  ' ' +
  '<div class="acct-panel" id="panel-settings"> ' +
  '<div class="acct-card"> ' +
  '<h3>Automation settings</h3> ' +
  '<div class="acct-card-sub">Applies to your personal follow-up activity.<span class="mock-flag">sample</span></div> ' +
  '<div class="toggle-row"><div><div class="toggle-label">Autonomous follow-up cadence</div><div class="toggle-sub">Send scheduled reminders automatically on your behalf.</div></div><label class="switch"><input type="checkbox" checked><span class="slider"></span></label></div> ' +
  '<div class="toggle-row"><div><div class="toggle-label">AI drafting</div><div class="toggle-sub">Let clAIms draft follow-up emails for your review.</div></div><label class="switch"><input type="checkbox" checked><span class="slider"></span></label></div> ' +
  '<div class="toggle-row"><div><div class="toggle-label">Daily digest email</div><div class="toggle-sub">Get a morning summary of what needs attention.</div></div><label class="switch"><input type="checkbox"><span class="slider"></span></label></div> ' +
  '</div> ' +
  ' ' +
  '<div class="acct-card" id="permissionsCard" style="display:none;"> ' +
  '<h3>Permissions<span class="mock-flag">sample</span></h3> ' +
  '<div class="acct-card-sub">What each account type can do at your company.</div> ' +
  '<table class="perm-matrix"> ' +
  '<thead><tr><th>Capability</th><th>Employee</th><th>Manager</th><th>Admin</th></tr></thead> ' +
  '<tbody id="permMatrixRows"></tbody> ' +
  '</table> ' +
  '</div> ' +
  ' ' +
  '<div class="acct-card" id="integrationsCardOuter"> ' +
  '<h3>Integrations<span class="mock-flag">sample</span></h3> ' +
  '<div class="acct-card-sub" id="integrationsSub">Software connected to your dashboard.</div> ' +
  '<div id="integrationsRestricted" class="restricted-box" style="display:none;">Only admins can add or change integrations. Ask your company admin to make changes here.</div> ' +
  '<div id="integrationsContent" style="display:none;"> ' +
  '<div class="acct-grid" id="integrationsSummaryGrid"> ' +
  '<div class="acct-field"><label>QuickBooks</label><div class="acct-value">Connected</div></div> ' +
  '<div class="acct-field"><label>Salesforce</label><div class="acct-value">Not connected</div></div> ' +
  '</div> ' +
  '<div style="margin-top:14px;"><button class="btn-outline btn-sm" onclick="openManageIntegrations()">Manage integrations</button></div> ' +
  '</div> ' +
  '</div> ' +
  '</div> ' +
  ' ' +
  '</div> ' +
  '</div> ' +
  ' ' +
  '<div class="edit-modal-backdrop" id="editModalBackdrop"> ' +
  '<div class="edit-modal"> ' +
  '<h4 id="editModalTitle">Edit team member</h4> ' +
  '<div class="acct-field"><label>Name</label><input type="text" id="editModalName" disabled></div> ' +
  '<div class="acct-field"><label>Email</label><input type="email" id="editModalEmail" placeholder="name@company.com"></div> ' +
  '<div class="acct-field"><label>Department</label><input type="text" id="editModalDept"></div> ' +
  '<div class="acct-field"><label>Office</label><input type="text" id="editModalOffice"></div> ' +
  '<div class="acct-field"><label>Account type</label> ' +
  '<select id="editModalRole"> ' +
  '<option value="employee">Employee</option> ' +
  '<option value="manager">Manager</option> ' +
  '<option value="admin">Admin</option> ' +
  '</select> ' +
  '</div> ' +
  '<div class="acct-card-sub" id="editModalNote" style="margin-top:-6px;"></div> ' +
  '<div class="edit-modal-actions"> ' +
  '<button class="btn-outline btn-sm" id="editModalCancel">Cancel</button> ' +
  '<button class="btn-outline btn-sm" id="editModalRemove" style="color:#B0473F;border-color:#F0C9C4;">Remove user</button> ' +
  '<button class="btn-dark btn-sm" id="editModalSave">Save changes</button> ' +
  '</div> ' +
  '</div> ' +
  '</div> ' +
  ' ' +
   '<div class="edit-modal-backdrop" id="integrationsModalBackdrop"> ' +
 '<div class="edit-modal" style="max-width:540px;"> ' +
 '<h4>Manage Integrations</h4> ' +
 '<div class="acct-card-sub" style="margin-top:-4px;margin-bottom:14px;">Sample data for demo purposes &mdash; connect, disconnect, or recategorize the tools below.</div> ' +
 '<div id="integrationsModalList"></div> ' +
 '<div class="edit-modal-actions"> ' +
 '<button class="btn-dark btn-sm" id="integrationsModalClose" onclick="closeManageIntegrations()">Done</button> ' +
 '</div> ' +
 '</div> ' +
 '</div> ' +
'<script>(function(){ ' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}} ' +
  ' ' +
  'var ROLE_RANK={admin:0,manager:1,employee:2}; ' +
  'var ROLE_LABEL={admin:"Admin",manager:"Manager",employee:"Employee"}; ' +
 'var INTEGRATION_CATEGORIES=["Accounting","CRM","ERP","Estimating","E-Signature","Payments","Storage","Other"]; ' +
 'var INTEGRATIONS_CATALOG=[{id:"quickbooks",name:"QuickBooks",category:"Accounting",connected:true},{id:"salesforce",name:"Salesforce",category:"CRM",connected:false},{id:"netsuite",name:"NetSuite",category:"ERP",connected:false},{id:"xactimate",name:"Xactimate",category:"Estimating",connected:false},{id:"docusign",name:"DocuSign",category:"E-Signature",connected:false}]; ' +
  ' ' +
  'var PLAN_FEATURES={ ' +
  '  starter:{name:"Starter",features:["2–3 user seats","1 integration","Autonomous cadence & AI drafting","A/R spreadsheet & aging reports","Email support"]}, ' +
  '  growth:{name:"Growth",features:["5–8 user seats","QuickBooks, Dash, Salesforce, NetSuite, and more","Everything in Starter","Invoiced MTD & Collected reporting by office","Priority support"]}, ' +
  '  enterprise:{name:"Enterprise",features:["Unlimited seats","All integrations","Everything in Growth","Multi-office & multi-entity support","Dedicated account manager"]} ' +
  '}; ' +
  ' ' +
  'var MOCK_TEAM=[ ' +
  '  {id:1,name:"Dana Whitfield",email:"dana.whitfield@example.com",dept:"Collections",office:"Dallas HQ",role:"admin"}, ' +
  '  {id:2,name:"Marcus Ojeda",email:"marcus.ojeda@example.com",dept:"Operations",office:"Austin",role:"manager"}, ' +
  '  {id:3,name:"Priya Chandran",email:"priya.chandran@example.com",dept:"Collections",office:"Dallas HQ",role:"manager"}, ' +
  '  {id:4,name:"Sam Fielding",email:"sam.fielding@example.com",dept:"Accounting",office:"Austin",role:"employee"}, ' +
  '  {id:5,name:"Leah Buckner",email:"leah.buckner@example.com",dept:"Collections",office:"Houston",role:"employee"}, ' +
  '  {id:6,name:"Reese Alvarado",email:"reese.alvarado@example.com",dept:"Operations",office:"Houston",role:"employee"}, ' +
  '  {id:7,name:"Tyler Nakamura",email:"tyler.nakamura@example.com",dept:"Accounting",office:"Dallas HQ",role:"employee"} ' +
  ']; ' +
  ' ' +
  'var MOCK_TX=[ ' +
  '  {date:"Aug 1, 2026",desc:"Monthly subscription",amount:"$899.00",status:"Paid"}, ' +
  '  {date:"Jul 1, 2026",desc:"Monthly subscription",amount:"$899.00",status:"Paid"}, ' +
  '  {date:"Jun 1, 2026",desc:"Monthly subscription",amount:"$899.00",status:"Paid"}, ' +
  '  {date:"May 12, 2026",desc:"Implementation fee",amount:"$4,900.00",status:"Paid"} ' +
  ']; ' +
  ' ' +
  'var PERM_ROWS=[ ' +
  '  {label:"View own account info",employee:true,manager:true,admin:true}, ' +
  '  {label:"View all team members",employee:true,manager:true,admin:true}, ' +
  '  {label:"Add / remove team members",employee:false,manager:true,admin:true}, ' +
  '  {label:"Edit team member permissions",employee:false,manager:true,admin:true}, ' +
  '  {label:"View team credentials / reset passwords",employee:false,manager:false,admin:true}, ' +
  '  {label:"Manually apply a payment",employee:false,manager:true,admin:true}, ' +
  '  {label:"Manage subscription & payment method",employee:false,manager:false,admin:true}, ' +
  '  {label:"Add / change integrations",employee:false,manager:false,admin:true} ' +
  ']; ' +
  ' ' +
  'function initials(name){ ' +
  '  var parts=String(name||"").trim().split(/\\s+/); ' +
  '  return ((parts[0]||"")[0]||"")+((parts[1]||"")[0]||""); ' +
  '} ' +
  ' ' +
  'ready(function(){ ' +
  '  var state={me:null,team:MOCK_TEAM.slice(),editingId:null,freq:{ ' +
  '    days:(function(){var a=[];for(var i=0;i<30;i++){a.push(i%7!==5&&i%7!==6);}return a;})(), ' +
  '    noilEnabled:true,noilDay:45, ' +
  '    demandEnabled:true,demandDay:60, ' +
  '    quietStart:"18:00",quietEnd:"08:00", ' +
  '    maxPerWeek:2, ' +
  '    escalateEnabled:true,escalateAfter:3, ' +
  '    senderName:"" ' +
  '  }}; ' +
  ' ' +
  '  fetch("/api/me",{credentials:"same-origin"}).then(function(r){return r.json();}).then(function(data){ ' +
  '    if(!data||!data.ok){ ' +
  '      window.location.href="/?login=1"; ' +
  '      return; ' +
  '    } ' +
  '    state.me=data; ' +
  '    if(!state.freq.senderName){ state.freq.senderName=(data.companyName||"Your Company")+" Collections Team"; } ' +
  '    render(); ' +
  '  }).catch(function(){ ' +
  '    window.location.href="/?login=1"; ' +
  '  }); ' +
  ' ' +
  '  function role(){ return (state.me && state.me.role) || "employee"; } ' +
  '  function plan(){ return (state.me && (state.me.selectedPlan || state.me.recommendedPlan)) || "growth"; } ' +
  ' ' +
  '  function render(){ ' +
  '    document.getElementById("acctLoading").style.display="none"; ' +
  '    document.getElementById("acctPanels").style.display="block"; ' +
  ' ' +
  '    var r=role(); ' +
  '    document.getElementById("acctUserChip").innerHTML= ' +
  '      "<b>"+(state.me.email||"")+"</b>"+ ' +
  '      "<span class=\\"acct-role-badge "+r+"\\">"+ROLE_LABEL[r]+"</span>"; ' +
  ' ' +
  '    renderAccountTab(); ' +
  '    renderBillingTab(); ' +
  '    renderTeamTab(); ' +
  '    renderFrequencyTab(); ' +
  '    renderSettingsTab(); ' +
  '    wireTabs(); ' +
  '    wireEditModal(); ' +
  '  } ' +
  ' ' +
  '  function renderAccountTab(){ ' +
  '    document.getElementById("acctFullName").textContent=state.me.email.split("@")[0].replace(/[._]/g," ").replace(/\\b\\w/g,function(c){return c.toUpperCase();}); ' +
  '    document.getElementById("acctEmail").textContent=state.me.email; ' +
  '    document.getElementById("acctCompany").textContent=state.me.companyName||"—"; ' +
  '    document.getElementById("acctRoleValue").innerHTML="<span class=\\"role-pill "+role()+"\\">"+ROLE_LABEL[role()]+"</span>"; ' +
  '    document.getElementById("acctJoined").innerHTML="March 2025 <span class=\\"mock-flag\\">sample</span>"; ' +
  '  } ' +
  ' ' +
  '  function renderBillingTab(){ ' +
  '    var r=role(); ' +
  '    var canView=(r==="admin"||r==="manager"); ' +
  '    document.getElementById("billingRestricted").style.display=canView?"none":"block"; ' +
  '    document.getElementById("billingContent").style.display=canView?"block":"none"; ' +
  '    if(!canView){ return; } ' +
  ' ' +
  '    var p=plan(); ' +
  '    var planInfo=PLAN_FEATURES[p]||PLAN_FEATURES.growth; ' +
  '    document.getElementById("billingPlanName").textContent=planInfo.name; ' +
  '    var list=document.getElementById("planFeatureList"); ' +
  '    list.innerHTML=""; ' +
  '    planInfo.features.forEach(function(f){ ' +
  '      var li=document.createElement("li"); ' +
  '      li.textContent=f; ' +
  '      list.appendChild(li); ' +
  '    }); ' +
  '    document.getElementById("billingAddress").textContent="123 Main St, Dallas, TX 75201"; ' +
  ' ' +
  '    var txRows=document.getElementById("billingTxRows"); ' +
  '    txRows.innerHTML=""; ' +
  '    MOCK_TX.forEach(function(tx){ ' +
  '      var tr=document.createElement("tr"); ' +
  '      tr.innerHTML="<td>"+tx.date+"</td><td>"+tx.desc+"</td><td>"+tx.amount+"</td><td>"+tx.status+"</td>"; ' +
  '      txRows.appendChild(tr); ' +
  '    }); ' +
  ' ' +
  '    document.getElementById("manageSubBtn").style.display=(r==="admin")?"inline-block":"none"; ' +
  '    document.getElementById("billingAdminActions").style.display=(r==="admin")?"flex":"none"; ' +
  '    document.getElementById("billingManagerActions").style.display=(r!=="admin")?"block":"none"; ' +
  '  } ' +
  ' ' +
  '  function populateFilterOptions(){ ' +
  '    var offices={},depts={}; ' +
  '    state.team.forEach(function(u){ offices[u.office]=1; depts[u.dept]=1; }); ' +
  '    var officeSel=document.getElementById("filterOffice"); ' +
  '    var deptSel=document.getElementById("filterDept"); ' +
  '    var curOffice=officeSel.value; ' +
  '    var curDept=deptSel.value; ' +
  '    officeSel.innerHTML="<option value=\\"\\">All offices</option>"+Object.keys(offices).sort().map(function(o){return "<option value=\\""+o+"\\">"+o+"</option>";}).join(""); ' +
  '    deptSel.innerHTML="<option value=\\"\\">All departments</option>"+Object.keys(depts).sort().map(function(d){return "<option value=\\""+d+"\\">"+d+"</option>";}).join(""); ' +
  '    officeSel.value=curOffice; ' +
  '    deptSel.value=curDept; ' +
  '  } ' +
  ' ' +
  '  function renderTeamTab(){ ' +
  '    var r=role(); ' +
  '    populateFilterOptions(); ' +
  ' ' +
  '    var canSeeCreds=(r==="admin"); ' +
  '    var canEdit=(r==="admin"||r==="manager"); ' +
  '    document.getElementById("teamCredHeader").style.display=canSeeCreds?"table-cell":"none"; ' +
  '    document.getElementById("teamEditHeader").style.display=canEdit?"table-cell":"none"; ' +
  ' ' +
  '    var officeVal=document.getElementById("filterOffice").value; ' +
  '    var deptVal=document.getElementById("filterDept").value; ' +
  '    var typeVal=document.getElementById("filterType").value; ' +
  ' ' +
  '    var rows=state.team.filter(function(u){ ' +
  '      if(officeVal&&u.office!==officeVal) return false; ' +
  '      if(deptVal&&u.dept!==deptVal) return false; ' +
  '      if(typeVal&&u.role!==typeVal) return false; ' +
  '      return true; ' +
  '    }).sort(function(a,b){ ' +
  '      if(ROLE_RANK[a.role]!==ROLE_RANK[b.role]) return ROLE_RANK[a.role]-ROLE_RANK[b.role]; ' +
  '      return a.name.localeCompare(b.name); ' +
  '    }); ' +
  ' ' +
  '    var tbody=document.getElementById("teamRows"); ' +
  '    tbody.innerHTML=""; ' +
  '    var lastRank=-1; ' +
  '    rows.forEach(function(u){ ' +
  '      if(ROLE_RANK[u.role]!==lastRank){ ' +
  '        lastRank=ROLE_RANK[u.role]; ' +
  '        var divider=document.createElement("tr"); ' +
  '        var colCount=5+(canSeeCreds?1:0)+(canEdit?1:0); ' +
  '        divider.innerHTML="<td colspan=\\""+colCount+"\\" class=\\"section-divider\\">"+ROLE_LABEL[u.role]+"s</td>"; ' +
  '        tbody.appendChild(divider); ' +
  '      } ' +
  '      var tr=document.createElement("tr"); ' +
  '      var credsCell=canSeeCreds?"<td><button class=\\"btn-outline btn-sm\\" data-reset=\\""+u.id+"\\">Reset password</button></td>":""; ' +
  '      var canEditThisRow=canEdit&&!(r==="manager"&&u.role==="admin"); ' +
  '      var editCell=canEdit?("<td>"+(canEditThisRow?"<button class=\\"btn-outline btn-sm\\" data-edit=\\""+u.id+"\\">Edit</button>":"<span style=\\"color:#B7B2A4;font-size:12px;\\">Locked</span>")+"</td>"):""; ' +
  '      tr.innerHTML= ' +
  '        "<td><div class=\\"team-name-cell\\"><div class=\\"team-avatar\\">"+initials(u.name)+"</div>"+u.name+"</div></td>"+ ' +
  '        "<td>"+u.email+"</td>"+ ' +
  '        "<td>"+u.dept+"</td>"+ ' +
  '        "<td>"+u.office+"</td>"+ ' +
  '        "<td><span class=\\"role-pill "+u.role+"\\">"+ROLE_LABEL[u.role]+"</span></td>"+ ' +
  '        credsCell+editCell; ' +
  '      tbody.appendChild(tr); ' +
  '    }); ' +
  ' ' +
  '    if(canEdit && !document.getElementById("addUserBtnWrap")){ ' +
  '      var wrap=document.createElement("div"); ' +
  '      wrap.id="addUserBtnWrap"; ' +
  '      wrap.style.marginTop="16px"; ' +
  '      wrap.innerHTML="<button class=\\"btn-dark btn-sm\\" id=\\"addUserBtn\\">+ Add user</button>"; ' +
  '      tbody.parentNode.parentNode.appendChild(wrap); ' +
  '      document.getElementById("addUserBtn").addEventListener("click",function(){ openEditModal(null); }); ' +
  '    } ' +
  ' ' +
  '    tbody.querySelectorAll("[data-edit]").forEach(function(btn){ ' +
  '      btn.addEventListener("click",function(){ openEditModal(parseInt(btn.getAttribute("data-edit"),10)); }); ' +
  '    }); ' +
  '    tbody.querySelectorAll("[data-reset]").forEach(function(btn){ ' +
  '      btn.addEventListener("click",function(){ ' +
  '        btn.textContent="Reset link sent"; ' +
  '        btn.disabled=true; ' +
  '      }); ' +
  '    }); ' +
  ' ' +
  '    ["filterOffice","filterDept","filterType"].forEach(function(id){ ' +
  '      var el=document.getElementById(id); ' +
  '      el.onchange=renderTeamTab; ' +
  '    }); ' +
  '  } ' +
  ' ' +
   'function renderIntegrationsSummary(){ ' +
 'var grid=document.getElementById("integrationsSummaryGrid"); ' +
 'if(!grid) return; ' +
 'var connected=INTEGRATIONS_CATALOG.filter(function(i){return i.connected;}); ' +
 'grid.innerHTML=connected.length?connected.map(function(i){return "<div class=\\"acct-field\\"><label>"+i.name+"</label><div class=\\"acct-value\\">Connected</div></div>"; }).join(""):"<div class=\\"acct-field\\"><label>None</label><div class=\\"acct-value\\">No integrations connected</div></div>"; ' +
 '} ' +
 'function renderIntegrationsModalList(){ ' +
 'var wrap=document.getElementById("integrationsModalList"); ' +
 'if(!wrap) return; ' +
 'wrap.innerHTML=INTEGRATIONS_CATALOG.map(function(i,idx){ ' +
 'var opts=INTEGRATION_CATEGORIES.map(function(c){return "<option value=\\""+c+"\\""+(c===i.category?" selected":"")+">"+c+"</option>"; }).join(""); ' +
 'return "<div class=\\"acct-field\\" style=\\"display:flex;align-items:center;justify-content:space-between;gap:10px;\\"><div><div style=\\"font-weight:600;font-size:13.5px;\\">"+i.name+"</div><select onchange=\\"setIntegrationCategory("+idx+",this.value)\\" style=\\"margin-top:4px;font-size:11.5px;padding:4px 8px;border-radius:6px;border:1.5px solid #E5E0D2;\\">"+opts+"</select></div><button class=\\"btn-outline btn-sm\\" onclick=\\"toggleIntegration("+idx+")\\">"+(i.connected?"Remove":"Add")+"</button></div>"; ' +
 '}).join(""); ' +
 '} ' +
 'function setIntegrationCategory(idx,val){ ' +
 'INTEGRATIONS_CATALOG[idx].category=val; ' +
 '} ' +
 'function toggleIntegration(idx){ ' +
 'INTEGRATIONS_CATALOG[idx].connected=!INTEGRATIONS_CATALOG[idx].connected; ' +
 'renderIntegrationsModalList(); ' +
 'renderIntegrationsSummary(); ' +
 '} ' +
 'function openManageIntegrations(){ ' +
 'renderIntegrationsModalList(); ' +
 'document.getElementById("integrationsModalBackdrop").classList.add("open"); ' +
 '} ' +
 'function closeManageIntegrations(){ ' +
 'document.getElementById("integrationsModalBackdrop").classList.remove("open"); ' +
 '} ' +
 ' ' +
'  function renderSettingsTab(){ ' +
  '    var r=role(); ' +
  '    document.getElementById("integrationsCardOuter").style.display=(r==="admin")?"block":"none"; ' +
  '    document.getElementById("permissionsCard").style.display="block"; ' +
  '    if(true){ ' +
  '      var body=document.getElementById("permMatrixRows"); ' +
  '      body.innerHTML=""; ' +
  '      PERM_ROWS.forEach(function(row){ ' +
  '        var tr=document.createElement("tr"); ' +
  '        tr.innerHTML="<td>"+row.label+"</td>"+ ' +
  '          "<td class=\\""+(row.employee?"perm-yes":"perm-no")+"\\">"+(row.employee?"Yes":"No")+"</td>"+ ' +
  '          "<td class=\\""+(row.manager?"perm-yes":"perm-no")+"\\">"+(row.manager?"Yes":"No")+"</td>"+ ' +
  '          "<td class=\\""+(row.admin?"perm-yes":"perm-no")+"\\">"+(row.admin?"Yes":"No")+"</td>"; ' +
  '        body.appendChild(tr); ' +
  '      }); ' +
  '    } ' +
  '    document.getElementById("integrationsRestricted").style.display=(r==="admin")?"none":"none"; ' +
  '    document.getElementById("integrationsContent").style.display="block"; ' +
  '    var integActionsWrap=document.querySelector("#integrationsContent > div:last-child"); ' +
  '    if(integActionsWrap){ integActionsWrap.style.display=(r==="admin")?"block":"none"; } ' +
  '    document.getElementById("integrationsSub").textContent=(r==="admin")?"Software connected to your dashboard.":"Software connected to your dashboard. Ask your admin to make changes."; ' +
 'renderIntegrationsSummary(); ' +
  '  } ' +
  ' ' +
  '  function renderFrequencyTab(){ ' +
  '    var r=role(); ' +
  '    var canEdit=(r==="admin"); ' +
  '    var grid=document.getElementById("freqDayGrid"); ' +
  '    grid.innerHTML=""; ' +
  '    state.freq.days.forEach(function(isOn,idx){ ' +
  '      var day=idx+1; ' +
  '      var chip=document.createElement("div"); ' +
  '      chip.className="freq-day-chip"+(isOn?" on":"")+(canEdit?"":" readonly"); ' +
  '      chip.innerHTML="<span class=\\"freq-day-num\\">"+day+"</span>"+(isOn?"On":"Off"); ' +
  '      if(canEdit){ ' +
  '        chip.addEventListener("click",function(){ ' +
  '          state.freq.days[idx]=!state.freq.days[idx]; ' +
  '          renderFrequencyTab(); ' +
  '        }); ' +
  '      } ' +
  '      grid.appendChild(chip); ' +
  '    }); ' +
  ' ' +
  '    document.getElementById("noilEnabled").checked=state.freq.noilEnabled; ' +
  '    document.getElementById("noilDay").value=state.freq.noilDay; ' +
  '    document.getElementById("demandEnabled").checked=state.freq.demandEnabled; ' +
  '    document.getElementById("demandDay").value=state.freq.demandDay; ' +
  '    document.getElementById("quietStart").value=state.freq.quietStart; ' +
  '    document.getElementById("quietEnd").value=state.freq.quietEnd; ' +
  '    document.getElementById("maxPerWeek").value=state.freq.maxPerWeek; ' +
  '    document.getElementById("escalateEnabled").checked=state.freq.escalateEnabled; ' +
  '    document.getElementById("escalateAfter").value=state.freq.escalateAfter; ' +
  '    document.getElementById("senderName").value=state.freq.senderName; ' +
  ' ' +
  '    var assigneeSel=document.getElementById("escalateAssignee"); ' +
  '    if(!assigneeSel.dataset.built){ ' +
  '      assigneeSel.innerHTML=MOCK_TEAM.filter(function(u){return u.role==="admin"||u.role==="manager";}).sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(u){return "<option value=\\""+u.id+"\\">"+u.name+"</option>";}).join(""); ' +
  '      assigneeSel.dataset.built="1"; ' +
  '    } ' +
  ' ' +
  '    ["noilEnabled","noilDay","demandEnabled","demandDay","quietStart","quietEnd","maxPerWeek","escalateEnabled","escalateAfter","escalateAssignee","senderName"].forEach(function(id){ ' +
  '      document.getElementById(id).disabled=!canEdit; ' +
  '    }); ' +
  ' ' +
  '    document.getElementById("freqActions").style.display=canEdit?"flex":"none"; ' +
  '    document.getElementById("freqReadonlyNote").style.display=canEdit?"none":"block"; ' +
  ' ' +
  '    var saveBtn=document.getElementById("freqSaveBtn"); ' +
  '    if(canEdit && !saveBtn.dataset.wired){ ' +
  '      saveBtn.addEventListener("click",function(){ ' +
  '        state.freq.noilEnabled=document.getElementById("noilEnabled").checked; ' +
  '        state.freq.noilDay=parseInt(document.getElementById("noilDay").value,10)||45; ' +
  '        state.freq.demandEnabled=document.getElementById("demandEnabled").checked; ' +
  '        state.freq.demandDay=parseInt(document.getElementById("demandDay").value,10)||60; ' +
  '        state.freq.quietStart=document.getElementById("quietStart").value; ' +
  '        state.freq.quietEnd=document.getElementById("quietEnd").value; ' +
  '        state.freq.maxPerWeek=parseInt(document.getElementById("maxPerWeek").value,10)||2; ' +
  '        state.freq.escalateEnabled=document.getElementById("escalateEnabled").checked; ' +
  '        state.freq.escalateAfter=parseInt(document.getElementById("escalateAfter").value,10)||3; ' +
  '        state.freq.senderName=document.getElementById("senderName").value; ' +
  '        var note=document.getElementById("freqSavedNote"); ' +
  '        note.style.display="block"; ' +
  '        setTimeout(function(){ note.style.display="none"; },2200); ' +
  '      }); ' +
  '      saveBtn.dataset.wired="1"; ' +
  '    } ' +
  '  } ' +
  ' ' +
  '  function wireTabs(){ ' +
  '    var tabs=document.querySelectorAll(".acct-tab"); ' +
  '    tabs.forEach(function(tab){ ' +
  '      tab.addEventListener("click",function(){ ' +
  '        tabs.forEach(function(t){ t.classList.remove("active"); }); ' +
  '        tab.classList.add("active"); ' +
  '        document.querySelectorAll(".acct-panel").forEach(function(p){ p.classList.remove("active"); }); ' +
  '        document.getElementById("panel-"+tab.getAttribute("data-tab")).classList.add("active"); ' +
  '      }); ' +
  '    }); ' +
  '  } ' +
  ' ' +
  '  function openEditModal(id){ ' +
  '    state.editingId=id; ' +
  '    var backdrop=document.getElementById("editModalBackdrop"); ' +
  '    var isNew=(id===null); ' +
  '    var user=isNew?{name:"",dept:"",office:"",role:"employee"}:state.team.filter(function(u){return u.id===id;})[0]; ' +
  '    document.getElementById("editModalTitle").textContent=isNew?"Add team member":"Edit team member"; ' +
  '    document.getElementById("editModalName").value=isNew?"":user.name; ' +
  '    document.getElementById("editModalName").disabled=!isNew; ' +
  '    document.getElementById("editModalName").placeholder=isNew?"Full name":""; ' +
  '    document.getElementById("editModalEmail").value=isNew?"":user.email; ' +
  '    document.getElementById("editModalEmail").disabled=!isNew; ' +
  '    document.getElementById("editModalEmail").placeholder=isNew?"name@company.com":""; ' +
  '    document.getElementById("editModalDept").value=user.dept; ' +
  '    document.getElementById("editModalOffice").value=user.office; ' +
  '    document.getElementById("editModalRole").value=user.role; ' +
  '    var roleSelect=document.getElementById("editModalRole"); ' +
  '    Array.prototype.forEach.call(roleSelect.options,function(opt){ ' +
  '      opt.disabled=(role()==="manager"&&opt.value==="admin"); ' +
  '    }); ' +
  '    document.getElementById("editModalNote").textContent=(role()==="manager")?"Managers cannot promote a user to Admin.":""; ' +
  '    document.getElementById("editModalRemove").style.display=isNew?"none":"inline-block"; ' +
  '    backdrop.classList.add("open"); ' +
  '  } ' +
  ' ' +
  '  function wireEditModal(){ ' +
  '    document.getElementById("editModalCancel").addEventListener("click",function(){ ' +
  '      document.getElementById("editModalBackdrop").classList.remove("open"); ' +
  '    }); ' +
  '    document.getElementById("editModalSave").addEventListener("click",function(){ ' +
  '      var name=document.getElementById("editModalName").value.trim(); ' +
  '      var dept=document.getElementById("editModalDept").value.trim(); ' +
  '      var office=document.getElementById("editModalOffice").value.trim(); ' +
  '      var newRole=document.getElementById("editModalRole").value; ' +
  '    var email=document.getElementById("editModalEmail").value.trim(); ' +
  '      if(state.editingId===null){ ' +
  '        if(!name){ return; } ' +
  '        var nextId=Math.max.apply(null,state.team.map(function(u){return u.id;}))+1; ' +
  '        state.team.push({id:nextId,name:name,email:email||(name.toLowerCase().replace(/\\s+/g,".")+"@example.com"),dept:dept,office:office,role:newRole}); ' +
  '      }else{ ' +
  '        state.team=state.team.map(function(u){ ' +
  '          if(u.id!==state.editingId) return u; ' +
  '          return Object.assign({},u,{dept:dept,office:office,role:newRole}); ' +
  '        }); ' +
  '      } ' +
  '      document.getElementById("editModalBackdrop").classList.remove("open"); ' +
  '      renderTeamTab(); ' +
  '    }); ' +
  '    document.getElementById("editModalRemove").addEventListener("click",function(){ ' +
  '      state.team=state.team.filter(function(u){ return u.id!==state.editingId; }); ' +
  '      document.getElementById("editModalBackdrop").classList.remove("open"); ' +
  '      renderTeamTab(); ' +
  '    }); ' +
  '  } ' +
  '}); ' +
  '})(); ' +
  '</script> ' +
  '</body></html> ' +
  ' ';

const PRICING_LINKS_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var tiersRow=document.getElementById("tiersRow");' +
  'if(!tiersRow){return;}' +
  'var startPrice=tiersRow.querySelector(".tier.starter .tier-price");' +
  'if(startPrice){startPrice.innerHTML="$249<span class=\\"per\\">–$409/mo</span>";}' +
  'var startImpl=tiersRow.querySelector(".tier.starter .tier-impl b");' +
  'if(startImpl){startImpl.textContent="$1,250–$2,050";}' +
  'var growPrice=tiersRow.querySelector(".tier.growth .tier-price");' +
  'if(growPrice){growPrice.innerHTML="$739<span class=\\"per\\">–$1,649/mo</span>";}' +
  'var growImpl=tiersRow.querySelector(".tier.growth .tier-impl b");' +
  'if(growImpl){growImpl.textContent="$2,900–$3,750";}' +
  'var entPrice=tiersRow.querySelector(".tier.enterprise .tier-price");' +
  'if(entPrice){entPrice.innerHTML="$1,650<span class=\\"per\\">/mo flat</span>";}' +
  'var entImpl=tiersRow.querySelector(".tier.enterprise .tier-impl b");' +
  'if(entImpl){entImpl.textContent="$4,250";}' +
  'var startFit=tiersRow.querySelector(".tier.starter .tier-fit");' +
  'if(startFit){startFit.textContent="Under $500K in annual revenue";}' +
  'var growFit=tiersRow.querySelector(".tier.growth .tier-fit");' +
  'if(growFit){growFit.textContent="$500K–$2M in annual revenue";}' +
  'var entFit=tiersRow.querySelector(".tier.enterprise .tier-fit");' +
  'if(entFit){entFit.textContent="$2M+ in annual revenue, multiple offices or entities";}' +
  'var tierBtns=tiersRow.querySelectorAll("a.btn-tier");' +
  'for(var i=0;i<tierBtns.length;i++){' +
  '(function(a){' +
  'a.removeAttribute("href");' +
  'a.removeAttribute("onclick");' +
  'a.textContent="Get started";' +
  'a.style.cursor="pointer";' +
  'a.addEventListener("click",function(e){' +
  'e.preventDefault();' +
  'if(typeof openSignup==="function"){openSignup();}' +
  '});' +
  '})(tierBtns[i]);' +
  '}' +
  '});' +
  '})();' +
  '<' + '/script>';

const COMPARE_COPY_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var ps=document.querySelectorAll("p");' +
  'for(var i=0;i<ps.length;i++){' +
  'if(ps[i].textContent.indexOf("sit exactly in between")!==-1){' +
  'ps[i].textContent="Restoration platforms don\'t automate collections. Collections platforms don\'t integrate restoration knowledge. clAIms is built to sit exactly in between.";' +
  'break;' +
  '}' +
  '}' +
  '});' +
  '})();' +
  '<' + '/script>';

const ROI_CALC_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var labels=document.querySelectorAll("label");' +
  'for(var i=0;i<labels.length;i++){' +
  'if(labels[i].textContent.indexOf("Credit Sales")!==-1){' +
  'labels[i].textContent="Annual Revenue";' +
  'break;' +
  '}' +
  '}' +
  'var revenueInput=document.getElementById("revenue");' +
  'if(revenueInput){' +
  'setTimeout(function(){' +
  'revenueInput.value="10,000,000";' +
  'revenueInput.dispatchEvent(new Event("input",{bubbles:true}));' +
  '},50);' +
  '}' +
  '});' +
  '})();' +
  '<' + '/script>';

const DEMO_POPUP_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'setTimeout(function(){' +
  'if(location.hash==="#demo"){return;}' +
'if(/[?&]login=1\\b/.test(location.search)){return;}' +
'if(location.pathname!=="/"&&location.pathname!=="/index.html"){return;}' +
  'var wrap=document.createElement("div");' +
  'wrap.id="clms-demo-popup";' +
  'wrap.innerHTML=' +
  '\'<style>\'+' +
  '\'#clms-demo-popup{position:fixed;bottom:24px;left:24px;max-width:300px;background:#D32F2F;color:#fff;padding:16px 18px;border-radius:14px;box-shadow:0 20px 50px -15px rgba(179,25,25,0.55);z-index:99998;font-family:"IBM Plex Sans",Arial,sans-serif;cursor:pointer;animation:clmsPopIn .35s ease;}\'+' +
  '\'@keyframes clmsPopIn{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}\'+' +
  '\'@keyframes clmsBangPulse{0%,100%{opacity:1;}50%{opacity:.55;}}\'+' +
  '\'#clms-demo-popup .cdp-close{position:absolute;top:6px;right:10px;background:none;border:none;color:#fff;font-size:16px;cursor:pointer;opacity:.8;line-height:1;}\'+' +
  '\'#clms-demo-popup .cdp-close:hover{opacity:1;}\'+' +
  '\'#clms-demo-popup .cdp-bang{font-weight:800;font-size:15px;letter-spacing:.04em;margin-bottom:4px;animation:clmsBangPulse 1.1s ease-in-out infinite;}\'+' +
  '\'#clms-demo-popup .cdp-text{font-size:13.5px;line-height:1.5;font-weight:500;padding-right:14px;}\'+' +
  '\'@media (max-width:420px){#clms-demo-popup{left:16px;bottom:16px;max-width:calc(100vw - 32px);}}\'+' +
  '\'</style>\'+' +
  '\'<button class="cdp-close" aria-label="Dismiss">&times;</button>\'+' +
  '\'<div class="cdp-bang">!!!</div>\'+' +
  '\'<div class="cdp-text">Try out the interactive demo! Let us show you how everything works!</div>\';' +
  'document.body.appendChild(wrap);' +
  'wrap.addEventListener("click",function(e){' +
  'if(e.target&&e.target.className==="cdp-close"){' +
  'e.stopPropagation();' +
  'wrap.remove();' +
  'return;' +
  '}' +
  'wrap.remove();' +
  'var demoLink=document.querySelector(\'a[href="#demo"]\')||document.querySelector(\'a[href$="#demo"]\');' +
  'if(demoLink){demoLink.click();}' +
  'else{' +
  'location.hash="demo";' +
  'if(typeof loadDemoIfNeeded==="function"){loadDemoIfNeeded();}' +
  '}' +
  '});' +
  '},2000);' +
  '});' +
  '})();' +
  '<' + '/script>';

const DEMO_INTEGRATIONS_SEED_SCRIPT = '<script>' +
'(function(){' +
'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
'ready(function(){' +
'setTimeout(function(){' +
'if(typeof state!=="undefined"&&state.customIntegrations&&state.customIntegrations.length===0){' +
'state.customIntegrations.push(' +
'{id:state.nextIntegrationId++,name:"Salesforce",category:"crm",environment:"production",baseUrl:"https://na1.salesforce.com",authType:"oauth2",syncFreq:"realtime",keyMasked:"sf_live_\u2022\u2022\u2022\u20227f2a",secretMasked:"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",notes:"",status:"connected",addedAt:"Jan 3, 2026",lastSyncedAt:Date.now()-4*60*1000},' +
'{id:state.nextIntegrationId++,name:"NetSuite",category:"accounting",environment:"production",baseUrl:"https://xxxxx.app.netsuite.com",authType:"oauth2",syncFreq:"hourly",keyMasked:"ns_\u2022\u2022\u2022\u202291cd",secretMasked:"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",notes:"",status:"connected",addedAt:"Jan 3, 2026",lastSyncedAt:Date.now()-52*60*1000}' +
'); ' +
'if(typeof saveState==="function") saveState();' +
'if(typeof renderCustomIntegrations==="function") renderCustomIntegrations();' +
'}' +
'},300);' +
'});' +
'})();' +
'<' + '/script>';

const DEMO_TOUR_SCRIPT = '<script>' +
  '(function(){' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
  'ready(function(){' +
  'var steps=[' +
  '{sel:"#nav",title:"Your command center",text:"Every stage of your AR lifecycle — from new invoices to collected cash — is one click away."},' +
  '{sel:"#kpis",title:"Live KPIs",text:"See exactly what is outstanding, overdue, and needs attention today, updated in real time."},' +
  '{sel:"#search",title:"Search and filter",text:"Find any invoice instantly by office, department, payer, or status."},' +
  '{sel:"#queue",title:"Your prioritized queue",text:"clAIms automatically ranks every open invoice so your team always knows who to follow up with next, and why."},' +
  '{sel:"#view-sheet .topbar",nav:"sheet",title:"A/R Spreadsheet",text:"Your full accounts receivable ledger in one place, with autonomous contact tracking. Notes update automatically as customers reply to follow-up emails or as records change in your account and homeowner database."},' +
  '{sel:"#view-report .topbar",nav:"report",title:"Aging, at a glance",text:"See exactly how much AR is sitting in each aging bucket, broken down by payer, so nothing slips through the cracks."},' +
  '{sel:"#view-invoicedmtd .topbar",nav:"invoicedmtd",title:"Invoiced Month to Date",text:"Synced automatically from your accounting and CRM systems, sorted by office and broken down by department, so you always know what went out this month."},' +
  '{sel:"#view-collectedmtd .topbar",nav:"collectedmtd",title:"Collected This Month",text:"Updates in real time as payments post, with notes and statuses refreshed automatically from customer email responses and your account database."},' +
  '{sel:"#view-collected .topbar",nav:"collected",title:"Collected",text:"All-time payments received, organized by year and month and filterable by office and department, always current thanks to automated updates pulled from customer responses and your homeowner records."},' +
  '{sel:"#view-automations",nav:"automations",title:"Automated follow-ups",text:"Set your cadence once. Follow-ups go out automatically, with a full activity trail for every action taken."},' +
  '{sel:"#view-integrations .topbar",nav:"integrations",title:"Connects to what you already use",text:"Plug clAIms into your restoration and accounting software so data flows in and payments flow back out, with no manual re-entry."},' +
  '{sel:"#money-wrap",nav:"queue",title:"Track cash collected in real time",text:"Watch your recovered revenue tick up as payments come in. That is the whole point."},' +
  '{click:"#clmsAcctTriggerBtn",sel:"#clmsAcctOverlay .cdap-topbar",title:"Your account page",text:"Every teammate lands here after logging in. It is where you manage your profile, billing, team, and settings without leaving clAIms."},' +
  '{click:\'#clmsAcctOverlay [data-tab="billing"]\',sel:"#cdap-panel-billing",title:"Payment & Billing",text:"Admins and managers can see the plan, payment method, and transaction history, and admins can manage the subscription right from here."},' +
  '{click:\'#clmsAcctOverlay [data-tab="team"]\',sel:"#cdap-panel-team",title:"My Team",text:"Filter your roster by office, department, or account type. Admins and managers can add, edit, or remove teammates and adjust their permissions here."},' +
  '{click:\'#clmsAcctOverlay [data-tab="frequency"]\',sel:"#cdap-panel-frequency",title:"Contact Frequency",text:"Set exactly which days automation runs, when a NOIL or demand letter gets drafted, and guardrails like quiet hours, weekly contact caps, and human escalation — all sent under your company name, never clAIms."},' +
  '{click:\'#clmsAcctOverlay [data-tab="settings"]\',sel:"#cdap-panel-settings",title:"Settings & Permissions",text:"Everyone controls their own automation preferences here, and admins can see exactly what each account type — employee, manager, admin — is allowed to do."},' +
  '{click:"#cdapCloseBtn",nav:"queue",sel:"#queue",title:"Back to your dashboard",text:"Close your account page any time to jump back into your queue."}' +
  '];' +
  'var idx=-1;' +
  'var spot,tip,replayBtn;' +
  'function ensureUI(){' +
  'if(spot){return;}' +
  'var style=document.createElement("style");' +
  'style.textContent=' +
  '".clms-tour-spot{position:fixed;pointer-events:none;box-shadow:0 0 0 9999px rgba(10,10,10,.62);border-radius:10px;transition:top .25s ease,left .25s ease,width .25s ease,height .25s ease;z-index:999998;}" +' +
  '".clms-tour-tip{position:fixed;z-index:999999;background:#171717;color:#fff;border-radius:12px;padding:16px 18px;width:300px;box-shadow:0 20px 50px -15px rgba(0,0,0,.55);font-family:\\"IBM Plex Sans\\",Arial,sans-serif;}" +' +
  '".clms-tour-tip .ctt-step{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#C29B57;font-weight:700;margin-bottom:6px;}" +' +
  '".clms-tour-tip h4{margin:0 0 6px;font-size:15px;}" +' +
  '".clms-tour-tip p{margin:0 0 14px;font-size:13px;line-height:1.5;color:#D8D4C8;}" +' +
  '".clms-tour-tip .ctt-row{display:flex;justify-content:space-between;align-items:center;gap:8px;}" +' +
  '".clms-tour-tip button{font-family:inherit;font-size:12.5px;font-weight:600;border-radius:7px;padding:7px 12px;cursor:pointer;border:none;}" +' +
  '".clms-tour-tip .ctt-skip{background:none;color:#B7B2A4;padding:7px 4px;}" +' +
  '".clms-tour-tip .ctt-back{background:#2b2b2b;color:#fff;}" +' +
  '".clms-tour-tip .ctt-next{background:#C29B57;color:#171717;}" +' +
  '".clms-tour-replay{position:fixed;bottom:16px;left:16px;background:#171717;color:#fff;font-size:12px;font-weight:600;padding:9px 14px;border-radius:20px;cursor:pointer;z-index:999997;box-shadow:0 10px 24px -8px rgba(0,0,0,.4);font-family:\\"IBM Plex Sans\\",Arial,sans-serif;display:none;}" +' +
  '"@media (max-width:520px){.clms-tour-tip{width:calc(100vw - 32px);}}";' +
  'document.head.appendChild(style);' +
  'spot=document.createElement("div");spot.className="clms-tour-spot";spot.style.display="none";document.body.appendChild(spot);' +
  'tip=document.createElement("div");tip.className="clms-tour-tip";tip.style.display="none";document.body.appendChild(tip);' +
  'replayBtn=document.createElement("button");replayBtn.className="clms-tour-replay";replayBtn.innerHTML="&#8635; Replay tour";' +
  'replayBtn.addEventListener("click",function(){replayBtn.style.display="none";idx=-1;nextStep();});' +
  'document.body.appendChild(replayBtn);' +
  '}' +
  'function place(el){' +
  'var r=el.getBoundingClientRect();' +
  'var pad=6;' +
  'spot.style.top=(r.top-pad)+"px";' +
  'spot.style.left=(r.left-pad)+"px";' +
  'spot.style.width=(r.width+pad*2)+"px";' +
  'spot.style.height=(r.height+pad*2)+"px";' +
  'spot.style.display="block";' +
  'tip.style.visibility="hidden";' +
  'tip.style.display="block";' +
  'var th=tip.offsetHeight,tw=tip.offsetWidth;' +
  'var top=r.bottom+14;' +
  'if(top+th>window.innerHeight-10){top=r.top-th-14;}' +
  'if(top<10){top=10;}' +
  'var left=r.left;' +
  'if(left+tw>window.innerWidth-10){left=window.innerWidth-tw-10;}' +
  'if(left<10){left=10;}' +
  'tip.style.top=top+"px";' +
  'tip.style.left=left+"px";' +
  'tip.style.visibility="visible";' +
  '}' +
  'function renderTip(step,i){' +
  'tip.innerHTML=' +
  '"<div class=\\"ctt-step\\">Step "+(i+1)+" of "+steps.length+"</div>"+' +
  '"<h4>"+step.title+"</h4>"+' +
  '"<p>"+step.text+"</p>"+' +
  '"<div class=\\"ctt-row\\"><button class=\\"ctt-skip\\" id=\\"clmsTourSkip\\">Skip tour</button>"+' +
  '"<div style=\\"display:flex;gap:8px;\\">"+' +
  '(i>0?"<button class=\\"ctt-back\\" id=\\"clmsTourBack\\">Back</button>":"")+' +
  '"<button class=\\"ctt-next\\" id=\\"clmsTourNext\\">"+(i===steps.length-1?"Finish":"Next")+"</button>"+' +
  '"</div></div>";' +
  'document.getElementById("clmsTourSkip").addEventListener("click",endTour);' +
  'var backBtn=document.getElementById("clmsTourBack");' +
  'if(backBtn){backBtn.addEventListener("click",function(){idx-=2;nextStep();});}' +
  'document.getElementById("clmsTourNext").addEventListener("click",function(){' +
  'if(i===steps.length-1){endTour();}else{nextStep();}' +
  '});' +
  '}' +
  'function nextStep(){' +
  'idx++;' +
  'if(idx>=steps.length){endTour();return;}' +
  'var step=steps[idx];' +
  'if(step.nav){' +
  'var btn=document.querySelector(\'.nav-item[data-view="\'+step.nav+\'"]\');' +
  'if(btn){btn.click();}' +
  '}' +
  'if(step.click){' +
  'var cbtn=document.querySelector(step.click);' +
  'if(cbtn){cbtn.click();}' +
  '}' +
  'setTimeout(function(){' +
  'var el=document.querySelector(step.sel);' +
  'if(!el){nextStep();return;}' +
  'el.scrollIntoView({block:"center"});' +
  'setTimeout(function(){place(el);renderTip(step,idx);},80);' +
  '},(step.nav||step.click)?320:0);' +
  '}' +
  'function endTour(){' +
  'if(spot){spot.style.display="none";}' +
  'if(tip){tip.style.display="none";}' +
  'if(replayBtn){replayBtn.style.display="block";}' +
  '}' +
  'ensureUI();' +
  'setTimeout(function(){nextStep();},900);' +
  '});' +
  '})();' +
  '<' + '/script>';

const DEMO_ACCOUNT_OVERLAY_SCRIPT = '<style> ' +
  '.cdap-trigger{position:fixed;top:16px;right:16px;z-index:99996;background:#171717;color:#fff;border:none;font-family:"IBM Plex Sans",Arial,sans-serif;font-weight:600;font-size:12.5px;padding:9px 16px;border-radius:20px;box-shadow:0 8px 20px -8px rgba(23,23,23,0.5);cursor:pointer;} ' +
  '#clmsAcctOverlay{display:none;position:fixed;inset:0;background:#F5F2EA;z-index:999995;overflow-y:auto;font-family:"IBM Plex Sans",Arial,sans-serif;color:#171717;} ' +
  '#clmsAcctOverlay *{box-sizing:border-box;} ' +
  '.cdap-topbar{background:#171717;color:#fff;padding:16px 28px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;} ' +
  '.cdap-brand{font-weight:700;font-size:18px;letter-spacing:.02em;} ' +
  '.cdap-topbar-right{display:flex;align-items:center;gap:16px;flex-wrap:wrap;} ' +
  '.cdap-user-chip{font-size:13px;color:#D8D4C8;} ' +
  '.cdap-user-chip b{color:#fff;} ' +
  '.cdap-role-badge{display:inline-block;margin-left:8px;padding:2px 9px;border-radius:20px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:#C29B57;color:#171717;} ' +
  '.cdap-close-btn{background:none;border:1.5px solid #4A4A46;color:#fff;font-weight:700;font-size:13px;padding:8px 16px;border-radius:8px;cursor:pointer;} ' +
  '.cdap-close-btn:hover{border-color:#C29B57;color:#C29B57;} ' +
  '.cdap-wrap{max-width:1080px;margin:0 auto;padding:28px 24px 80px;} ' +
  '.cdap-tabs{display:flex;gap:4px;border-bottom:1px solid #E5E0D2;margin-bottom:24px;overflow-x:auto;} ' +
  '.cdap-tab{background:none;border:none;font-family:inherit;font-size:14px;font-weight:600;color:#615D53;padding:12px 18px;cursor:pointer;border-bottom:3px solid transparent;white-space:nowrap;} ' +
  '.cdap-tab:hover{color:#171717;} ' +
  '.cdap-tab.active{color:#171717;border-bottom-color:#C29B57;} ' +
  '.cdap-panel{display:none;} ' +
  '.cdap-panel.active{display:block;} ' +
  '.cdap-card{background:#fff;border:1px solid #E5E0D2;border-radius:14px;padding:22px 24px;margin-bottom:18px;box-shadow:0 12px 30px -18px rgba(23,23,23,0.15);} ' +
  '.cdap-card h3{margin:0 0 4px;font-size:16px;} ' +
  '.cdap-card-sub{font-size:12.5px;color:#615D53;margin-bottom:16px;} ' +
  '.cdap-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 24px;} ' +
  '@media (max-width:640px){.cdap-grid{grid-template-columns:1fr;}} ' +
  '.cdap-field label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8A8578;font-weight:700;margin-bottom:5px;} ' +
  '.cdap-field .cdap-value{font-size:14.5px;color:#171717;padding:9px 0;border-bottom:1px solid #F0EDE3;} ' +
  '.cdap-btn-dark{background:#171717;color:#fff;border:none;font-weight:600;font-size:13px;padding:10px 18px;border-radius:8px;cursor:pointer;} ' +
  '.cdap-btn-outline{background:none;color:#171717;border:1.5px solid #E5E0D2;font-weight:600;font-size:13px;padding:9px 17px;border-radius:8px;cursor:pointer;} ' +
  '.cdap-btn-sm{font-size:12px;padding:6px 12px;border-radius:7px;} ' +
  '.cdap-plan-banner{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;background:#171717;color:#fff;border-radius:14px;padding:18px 22px;margin-bottom:18px;} ' +
  '.cdap-plan-banner .cdap-plan-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#C29B57;font-weight:700;margin-bottom:4px;} ' +
  '.cdap-plan-banner .cdap-plan-name{font-size:18px;font-weight:700;} ' +
  '.cdap-feature-list{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;} ' +
  '.cdap-feature-list li{font-size:13px;color:#3B3A35;padding-left:20px;position:relative;} ' +
  '.cdap-feature-list li:before{content:"✓";position:absolute;left:0;color:#C29B57;font-weight:700;} ' +
  '@media (max-width:640px){.cdap-feature-list{grid-template-columns:1fr;}} ' +
  'table.cdap-table{width:100%;border-collapse:collapse;font-size:13.5px;} ' +
  'table.cdap-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8A8578;font-weight:700;padding:10px 12px;border-bottom:1.5px solid #E5E0D2;} ' +
  'table.cdap-table td{padding:12px 12px;border-bottom:1px solid #F0EDE3;vertical-align:middle;} ' +
  'table.cdap-table tr:last-child td{border-bottom:none;} ' +
  '.cdap-filters-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;} ' +
  '.cdap-filters-row select{font-family:inherit;font-size:13px;padding:9px 12px;border:1.5px solid #E5E0D2;border-radius:8px;background:#fff;color:#171717;} ' +
  '.cdap-team-name-cell{display:flex;align-items:center;gap:10px;} ' +
  '.cdap-avatar{width:32px;height:32px;border-radius:50%;background:#F0EDE3;color:#615D53;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;} ' +
  '.cdap-role-pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;} ' +
  '.cdap-role-pill.admin{background:#F3E7D2;color:#8A6A2F;} ' +
  '.cdap-role-pill.manager{background:#DCE6F5;color:#2F4E80;} ' +
  '.cdap-role-pill.employee{background:#EAE8E1;color:#57544B;} ' +
  '.cdap-section-divider{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8A8578;font-weight:700;padding:16px 12px 6px;} ' +
  '.cdap-perm-matrix{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;} ' +
  '.cdap-perm-matrix th,.cdap-perm-matrix td{padding:9px 10px;border-bottom:1px solid #F0EDE3;text-align:left;} ' +
  '.cdap-perm-matrix th{color:#8A8578;font-size:11px;text-transform:uppercase;letter-spacing:.04em;} ' +
  '.cdap-perm-yes{color:#1E5245;font-weight:700;} ' +
  '.cdap-perm-no{color:#B7B2A4;} ' +
  '.cdap-toggle-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #F0EDE3;gap:16px;} ' +
  '.cdap-toggle-row:last-child{border-bottom:none;} ' +
  '.cdap-toggle-row .cdap-toggle-label{font-size:13.5px;color:#171717;font-weight:600;} ' +
  '.cdap-toggle-row .cdap-toggle-sub{font-size:12px;color:#8A8578;margin-top:2px;} ' +
  '.cdap-switch{position:relative;width:40px;height:22px;flex-shrink:0;} ' +
  '.cdap-switch input{opacity:0;width:0;height:0;} ' +
  '.cdap-switch .cdap-slider{position:absolute;inset:0;background:#E5E0D2;border-radius:22px;transition:.15s;cursor:pointer;} ' +
  '.cdap-switch .cdap-slider:before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.15s;} ' +
  '.cdap-switch input:checked + .cdap-slider{background:#C29B57;} ' +
  '.cdap-switch input:checked + .cdap-slider:before{transform:translateX(18px);} ' +
  '.cdap-mock-flag{display:inline-block;font-size:10px;color:#B08A3E;background:#FBF3E4;border:1px solid #EEDDB6;padding:2px 8px;border-radius:6px;margin-left:8px;font-weight:600;vertical-align:middle;} ' +
  '.cdap-freq-day-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:14px;} ' +
  '@media (max-width:640px){.cdap-freq-day-grid{grid-template-columns:repeat(4,1fr);}} ' +
  '.cdap-freq-day-chip{border:1.5px solid #E5E0D2;border-radius:8px;padding:8px 4px;text-align:center;font-size:11.5px;font-weight:600;color:#8A8578;cursor:pointer;background:#FBFAF6;user-select:none;} ' +
  '.cdap-freq-day-chip .cdap-freq-day-num{display:block;font-size:13px;font-weight:700;color:#171717;margin-bottom:2px;} ' +
  '.cdap-freq-day-chip.on{background:#FBF3E4;border-color:#C29B57;color:#8A6A2F;} ' +
  '.cdap-freq-day-chip.on .cdap-freq-day-num{color:#171717;} ' +
  '.cdap-freq-legend{display:flex;gap:18px;margin-top:12px;font-size:11.5px;color:#8A8578;} ' +
  '.cdap-freq-legend span{display:inline-flex;align-items:center;gap:6px;} ' +
  '.cdap-freq-legend .dot{width:10px;height:10px;border-radius:3px;display:inline-block;} ' +
  '.cdap-freq-legend .dot.on{background:#C29B57;} ' +
  '.cdap-freq-legend .dot.off{background:#E5E0D2;} ' +
  '.cdap-freq-inline-field{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;} ' +
  '.cdap-freq-inline-field label{font-size:12.5px;color:#615D53;} ' +
  '.cdap-freq-inline-field input[type=number]{width:70px;font-family:inherit;font-size:13px;padding:7px 9px;border:1.5px solid #E5E0D2;border-radius:7px;} ' +
  '.cdap-freq-inline-field input[type=time]{font-family:inherit;font-size:13px;padding:7px 9px;border:1.5px solid #E5E0D2;border-radius:7px;} ' +
  '.cdap-freq-inline-field select{font-family:inherit;font-size:13px;padding:7px 9px;border:1.5px solid #E5E0D2;border-radius:7px;} ' +
  '.cdap-freq-note{font-size:12px;color:#615D53;background:#F5F2EA;border-radius:8px;padding:10px 12px;margin-top:12px;line-height:1.5;} ' +
  '</style> ' +
  ' ' +
  '<button class="cdap-trigger" id="clmsAcctTriggerBtn">My Account</button> ' +
  ' ' +
  '<div id="clmsAcctOverlay"> ' +
  '<div class="cdap-topbar"> ' +
  '<div class="cdap-brand">clAIms</div> ' +
  '<div class="cdap-topbar-right"> ' +
  '<div class="cdap-user-chip"><b>demo.admin@yourcompany.com</b><span class="cdap-role-badge">Admin</span></div> ' +
  '<button class="cdap-close-btn" id="cdapCloseBtn">Close ✕</button> ' +
  '</div> ' +
  '</div> ' +
  ' ' +
  '<div class="cdap-wrap"> ' +
  '<div class="cdap-tabs" id="cdapTabs"> ' +
  '<button class="cdap-tab active" data-tab="account">Account</button> ' +
  '<button class="cdap-tab" data-tab="billing">Payment &amp; Billing</button> ' +
  '<button class="cdap-tab" data-tab="team">My Team</button> ' +
  '<button class="cdap-tab" data-tab="frequency">Contact Frequency</button> ' +
  '<button class="cdap-tab" data-tab="settings">Settings &amp; Permissions</button> ' +
  '</div> ' +
  ' ' +
  '<div class="cdap-panel active" id="cdap-panel-account"> ' +
  '<div class="cdap-card"> ' +
  '<h3>Account information</h3> ' +
  '<div class="cdap-card-sub">Your login and profile details.<span class="cdap-mock-flag">sample</span></div> ' +
  '<div class="cdap-grid"> ' +
  '<div class="cdap-field"><label>Full name</label><div class="cdap-value">Jordan Avery</div></div> ' +
  '<div class="cdap-field"><label>Username / Email</label><div class="cdap-value">demo.admin@yourcompany.com</div></div> ' +
  '<div class="cdap-field"><label>Company</label><div class="cdap-value">Your Company Name</div></div> ' +
  '<div class="cdap-field"><label>Account type</label><div class="cdap-value"><span class="cdap-role-pill admin">Admin</span></div></div> ' +
  '<div class="cdap-field"><label>Password</label><div class="cdap-value">••••••••••• <span style="color:#C29B57;font-weight:600;font-size:12.5px;">Change password</span></div></div> ' +
  '<div class="cdap-field"><label>Member since</label><div class="cdap-value">March 2025</div></div> ' +
  '</div> ' +
  '</div> ' +
  '</div> ' +
  ' ' +
  '<div class="cdap-panel" id="cdap-panel-billing"> ' +
  '<div class="cdap-plan-banner"> ' +
  '<div> ' +
  '<div class="cdap-plan-label">Current plan</div> ' +
  '<div class="cdap-plan-name">Growth</div> ' +
  '</div> ' +
  '<button class="cdap-btn-dark cdap-btn-sm" onclick="alert(\'In your real account, this opens a full subscription page where you can upgrade your plan or cancel future billing \u2014 handled securely through Stripe.\')">Manage Subscription</button> ' +
  '</div> ' +
  '<div class="cdap-card"> ' +
  '<h3>Plan features<span class="cdap-mock-flag">sample</span></h3> ' +
  '<ul class="cdap-feature-list"> ' +
  '<li>5–8 user seats</li> ' +
  '<li>QuickBooks, Dash, Salesforce, NetSuite, and more</li> ' +
  '<li>Everything in Starter</li> ' +
  '<li>Invoiced MTD &amp; Collected reporting by office</li> ' +
  '<li>Priority support</li> ' +
  '</ul> ' +
  '</div> ' +
  '<div class="cdap-card"> ' +
  '<h3>Payment method<span class="cdap-mock-flag">sample</span></h3> ' +
  '<div class="cdap-grid"> ' +
  '<div class="cdap-field"><label>Card on file</label><div class="cdap-value">Visa •••• 4242, exp 08/28</div></div> ' +
  '<div class="cdap-field"><label>Business address</label><div class="cdap-value">123 Main St, Dallas, TX 75201</div></div> ' +
  '</div> ' +
  '<div style="margin-top:14px;"><button class="cdap-btn-outline cdap-btn-sm">Update payment method</button></div> ' +
  '</div> ' +
  '<div class="cdap-card"> ' +
  '<h3>Transaction history<span class="cdap-mock-flag">sample</span></h3> ' +
  '<table class="cdap-table"> ' +
  '<thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead> ' +
  '<tbody> ' +
  '<tr><td>Aug 1, 2026</td><td>Monthly subscription</td><td>$899.00</td><td>Paid</td></tr> ' +
  '<tr><td>Jul 1, 2026</td><td>Monthly subscription</td><td>$899.00</td><td>Paid</td></tr> ' +
  '<tr><td>May 12, 2026</td><td>Implementation fee</td><td>$4,900.00</td><td>Paid</td></tr> ' +
  '</tbody> ' +
  '</table> ' +
  '</div> ' +
  '</div> ' +
  ' ' +
  '<div class="cdap-panel" id="cdap-panel-team"> ' +
  '<div class="cdap-card"> ' +
  '<h3>My Team<span class="cdap-mock-flag">sample data</span></h3> ' +
  '<div class="cdap-card-sub">Everyone at your company with a clAIms account.</div> ' +
  '<div class="cdap-filters-row"> ' +
  '<select id="cdapFilterOffice"><option value="">All offices</option></select> ' +
  '<select id="cdapFilterDept"><option value="">All departments</option></select> ' +
  '<select id="cdapFilterType"><option value="">All account types</option><option value="admin">Admin</option><option value="manager">Manager</option><option value="employee">Employee</option></select> ' +
  '</div> ' +
  '<table class="cdap-table"> ' +
  '<thead><tr> ' +
  '<th>Name</th><th>Email</th><th>Department</th><th>Office</th><th>Account type</th><th>Credentials</th><th>Actions</th> ' +
  '</tr></thead> ' +
  '<tbody id="cdapTeamRows"></tbody> ' +
  '</table> ' +
  '</div> ' +
  '</div> ' +
  ' ' +
  '<div class="cdap-panel" id="cdap-panel-frequency"> ' +
  '<div class="cdap-card"> ' +
  '<h3>Follow-up cadence (Day 1&ndash;30)<span class="cdap-mock-flag">sample</span></h3> ' +
  '<div class="cdap-card-sub">Choose which days after Day 1 your automated follow-ups go out. Turn any day off to create a quiet period.</div> ' +
  '<div class="cdap-freq-day-grid" id="cdapFreqDayGrid"></div> ' +
  '<div class="cdap-freq-legend"><span><span class="dot on"></span>Follow-up scheduled</span><span><span class="dot off"></span>Automation off</span></div> ' +
  '</div> ' +
  '<div class="cdap-card"> ' +
  '<h3>Notice of Intent to Lien (NOIL)</h3> ' +
  '<div class="cdap-card-sub">Draft a NOIL for review once an invoice reaches a set age.</div> ' +
  '<div class="cdap-toggle-row"><div><div class="cdap-toggle-label">Enable NOIL automation</div><div class="cdap-toggle-sub">clAIms drafts a NOIL for review; nothing sends without your approval.</div></div><label class="cdap-switch"><input type="checkbox" checked><span class="cdap-slider"></span></label></div> ' +
  '<div class="cdap-freq-inline-field"><label>Draft NOIL on day</label><input type="number" value="45" min="1" max="120"><span style="font-size:12.5px;color:#615D53;">since Day 1</span></div> ' +
  '</div> ' +
  '<div class="cdap-card"> ' +
  '<h3>Demand Letter</h3> ' +
  '<div class="cdap-card-sub">Draft a formal demand letter for review once an invoice reaches a set age.</div> ' +
  '<div class="cdap-toggle-row"><div><div class="cdap-toggle-label">Enable Demand Letter automation</div><div class="cdap-toggle-sub">clAIms drafts a demand letter for review; nothing sends without your approval.</div></div><label class="cdap-switch"><input type="checkbox" checked><span class="cdap-slider"></span></label></div> ' +
  '<div class="cdap-freq-inline-field"><label>Draft demand letter on day</label><input type="number" value="60" min="1" max="120"><span style="font-size:12.5px;color:#615D53;">since Day 1</span></div> ' +
  '</div> ' +
  '<div class="cdap-card"> ' +
  '<h3>Guardrails<span class="cdap-mock-flag">sample</span></h3> ' +
  '<div class="cdap-card-sub">Limits that keep automation respectful of customers, regardless of the cadence configured above.</div> ' +
  '<div class="cdap-freq-inline-field"><label>Quiet hours &mdash; no sends between</label><input type="time" value="18:00"><span style="font-size:12.5px;color:#615D53;">and</span><input type="time" value="08:00"></div> ' +
  '<div class="cdap-freq-inline-field"><label>Maximum automated contacts per customer, per week</label><input type="number" value="2" min="1" max="14"></div> ' +
  '<div class="cdap-toggle-row"><div><div class="cdap-toggle-label">Escalate to a human</div><div class="cdap-toggle-sub">Hand a customer off to a teammate after repeated unanswered contact.</div></div><label class="cdap-switch"><input type="checkbox" checked><span class="cdap-slider"></span></label></div> ' +
  '<div class="cdap-freq-inline-field"><label>Escalate after</label><input type="number" value="3" min="1" max="10"><span style="font-size:12.5px;color:#615D53;">unanswered follow-ups, assign to</span><select id="cdapEscalateAssignee"></select></div> ' +
  '<div class="cdap-freq-note">Every automated message includes a one-click opt-out. Customers who opt out are removed from all future automation immediately and flagged here for manual follow-up. This cannot be overridden by the cadence settings above.</div> ' +
  '</div> ' +
  '<div class="cdap-card"> ' +
  '<h3>Messaging identity</h3> ' +
  '<div class="cdap-card-sub">What customers see when a message arrives.</div> ' +
  '<div class="cdap-field"><label>Sender name</label><div class="cdap-value">Your Company Name Collections Team</div></div> ' +
  '<div class="cdap-freq-note">Every follow-up, NOIL, and demand letter is sent and signed as your company. Customers never see the clAIms platform name in a message.</div> ' +
  '</div> ' +
  '<div style="display:flex;justify-content:flex-end;"><button class="cdap-btn-dark">Save changes</button></div> ' +
  '</div> ' +
  ' ' +
  '<div class="cdap-panel" id="cdap-panel-settings"> ' +
  '<div class="cdap-card"> ' +
  '<h3>Automation settings</h3> ' +
  '<div class="cdap-card-sub">Applies to your personal follow-up activity.<span class="cdap-mock-flag">sample</span></div> ' +
  '<div class="cdap-toggle-row"><div><div class="cdap-toggle-label">Autonomous follow-up cadence</div><div class="cdap-toggle-sub">Send scheduled reminders automatically on your behalf.</div></div><label class="cdap-switch"><input type="checkbox" checked><span class="cdap-slider"></span></label></div> ' +
  '<div class="cdap-toggle-row"><div><div class="cdap-toggle-label">AI drafting</div><div class="cdap-toggle-sub">Let clAIms draft follow-up emails for your review.</div></div><label class="cdap-switch"><input type="checkbox" checked><span class="cdap-slider"></span></label></div> ' +
  '<div class="cdap-toggle-row"><div><div class="cdap-toggle-label">Daily digest email</div><div class="cdap-toggle-sub">Get a morning summary of what needs attention.</div></div><label class="cdap-switch"><input type="checkbox"><span class="cdap-slider"></span></label></div> ' +
  '</div> ' +
  '<div class="cdap-card"> ' +
  '<h3>Permissions<span class="cdap-mock-flag">sample</span></h3> ' +
  '<div class="cdap-card-sub">What each account type can do at your company.</div> ' +
  '<table class="cdap-perm-matrix"> ' +
  '<thead><tr><th>Capability</th><th>Employee</th><th>Manager</th><th>Admin</th></tr></thead> ' +
  '<tbody> ' +
  '<tr><td>View own account info</td><td class="cdap-perm-yes">Yes</td><td class="cdap-perm-yes">Yes</td><td class="cdap-perm-yes">Yes</td></tr> ' +
  '<tr><td>View all team members</td><td class="cdap-perm-yes">Yes</td><td class="cdap-perm-yes">Yes</td><td class="cdap-perm-yes">Yes</td></tr> ' +
  '<tr><td>Add / remove team members</td><td class="cdap-perm-no">No</td><td class="cdap-perm-yes">Yes</td><td class="cdap-perm-yes">Yes</td></tr> ' +
  '<tr><td>Edit team member permissions</td><td class="cdap-perm-no">No</td><td class="cdap-perm-yes">Yes</td><td class="cdap-perm-yes">Yes</td></tr> ' +
  '<tr><td>Reset teammate passwords</td><td class="cdap-perm-no">No</td><td class="cdap-perm-no">No</td><td class="cdap-perm-yes">Yes</td></tr> ' +
  '<tr><td>Manually apply a payment</td><td class="cdap-perm-no">No</td><td class="cdap-perm-yes">Yes</td><td class="cdap-perm-yes">Yes</td></tr> ' +
  '<tr><td>Manage subscription &amp; payment method</td><td class="cdap-perm-no">No</td><td class="cdap-perm-no">No</td><td class="cdap-perm-yes">Yes</td></tr> ' +
  '<tr><td>Add / change integrations</td><td class="cdap-perm-no">No</td><td class="cdap-perm-no">No</td><td class="cdap-perm-yes">Yes</td></tr> ' +
  '</tbody> ' +
  '</table> ' +
  '</div> ' +
  '<div class="cdap-card"> ' +
  '<h3>Integrations<span class="cdap-mock-flag">sample</span></h3> ' +
  '<div class="cdap-card-sub">Software connected to your dashboard.</div> ' +
  '<div class="cdap-grid"> ' +
  '<div class="cdap-field"><label>QuickBooks</label><div class="cdap-value">Connected</div></div> ' +
  '<div class="cdap-field"><label>Salesforce</label><div class="cdap-value">Not connected</div></div> ' +
  '</div> ' +
  '<div style="margin-top:14px;"><button class="cdap-btn-outline cdap-btn-sm">Manage integrations</button></div> ' +
  '</div> ' +
  '</div> ' +
  ' ' +
  '</div> ' +
  '</div> ' +
  '<script>(function(){ ' +
  'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}} ' +
  ' ' +
  'var CDAP_TEAM=[ ' +
  '  {name:"Jordan Avery",email:"demo.admin@yourcompany.com",dept:"Collections",office:"Dallas HQ",role:"admin"}, ' +
  '  {name:"Marcus Ojeda",email:"marcus.ojeda@example.com",dept:"Operations",office:"Austin",role:"manager"}, ' +
  '  {name:"Priya Chandran",email:"priya.chandran@example.com",dept:"Collections",office:"Dallas HQ",role:"manager"}, ' +
  '  {name:"Sam Fielding",email:"sam.fielding@example.com",dept:"Accounting",office:"Austin",role:"employee"}, ' +
  '  {name:"Leah Buckner",email:"leah.buckner@example.com",dept:"Collections",office:"Houston",role:"employee"}, ' +
  '  {name:"Reese Alvarado",email:"reese.alvarado@example.com",dept:"Operations",office:"Houston",role:"employee"} ' +
  ']; ' +
  'var CDAP_ROLE_RANK={admin:0,manager:1,employee:2}; ' +
  'var CDAP_ROLE_LABEL={admin:"Admin",manager:"Manager",employee:"Employee"}; ' +
  ' ' +
  'function cdapInitials(name){ ' +
  '  var parts=String(name||"").trim().split(/\\s+/); ' +
  '  return ((parts[0]||"")[0]||"")+((parts[1]||"")[0]||""); ' +
  '} ' +
  ' ' +
  'ready(function(){ ' +
  '  var overlay=document.getElementById("clmsAcctOverlay"); ' +
  '  var trigger=document.getElementById("clmsAcctTriggerBtn"); ' +
  '  if(!overlay||!trigger){return;} ' +
  ' ' +
  '  function openOverlay(){ ' +
  '    overlay.style.display="block"; ' +
  '    document.body.style.overflow="hidden"; ' +
  '  } ' +
  '  function closeOverlay(){ ' +
  '    overlay.style.display="none"; ' +
  '    document.body.style.overflow=""; ' +
  '  } ' +
  '  trigger.addEventListener("click",openOverlay); ' +
  '  var closeBtn=document.getElementById("cdapCloseBtn"); ' +
  '  if(closeBtn){closeBtn.addEventListener("click",closeOverlay);} ' +
  '  window.clmsOpenAccountOverlay=openOverlay; ' +
  '  window.clmsCloseAccountOverlay=closeOverlay; ' +
  ' ' +
  '  var tabs=overlay.querySelectorAll(".cdap-tab"); ' +
  '  tabs.forEach(function(tab){ ' +
  '    tab.addEventListener("click",function(){ ' +
  '      tabs.forEach(function(t){ t.classList.remove("active"); }); ' +
  '      tab.classList.add("active"); ' +
  '      overlay.querySelectorAll(".cdap-panel").forEach(function(p){ p.classList.remove("active"); }); ' +
  '      var panel=document.getElementById("cdap-panel-"+tab.getAttribute("data-tab")); ' +
  '      if(panel){panel.classList.add("active");} ' +
  '    }); ' +
  '  }); ' +
  ' ' +
  '  function populateFilters(){ ' +
  '    var offices={},depts={}; ' +
  '    CDAP_TEAM.forEach(function(u){ offices[u.office]=1; depts[u.dept]=1; }); ' +
  '    var officeSel=document.getElementById("cdapFilterOffice"); ' +
  '    var deptSel=document.getElementById("cdapFilterDept"); ' +
  '    officeSel.innerHTML="<option value=\\"\\">All offices</option>"+Object.keys(offices).sort().map(function(o){return "<option value=\\""+o+"\\">"+o+"</option>";}).join(""); ' +
  '    deptSel.innerHTML="<option value=\\"\\">All departments</option>"+Object.keys(depts).sort().map(function(d){return "<option value=\\""+d+"\\">"+d+"</option>";}).join(""); ' +
  '  } ' +
  ' ' +
  '  function renderTeam(){ ' +
  '    var officeVal=document.getElementById("cdapFilterOffice").value; ' +
  '    var deptVal=document.getElementById("cdapFilterDept").value; ' +
  '    var typeVal=document.getElementById("cdapFilterType").value; ' +
  ' ' +
  '    var rows=CDAP_TEAM.filter(function(u){ ' +
  '      if(officeVal&&u.office!==officeVal) return false; ' +
  '      if(deptVal&&u.dept!==deptVal) return false; ' +
  '      if(typeVal&&u.role!==typeVal) return false; ' +
  '      return true; ' +
  '    }).sort(function(a,b){ ' +
  '      if(CDAP_ROLE_RANK[a.role]!==CDAP_ROLE_RANK[b.role]) return CDAP_ROLE_RANK[a.role]-CDAP_ROLE_RANK[b.role]; ' +
  '      return a.name.localeCompare(b.name); ' +
  '    }); ' +
  ' ' +
  '    var tbody=document.getElementById("cdapTeamRows"); ' +
  '    tbody.innerHTML=""; ' +
  '    var lastRank=-1; ' +
  '    rows.forEach(function(u){ ' +
  '      if(CDAP_ROLE_RANK[u.role]!==lastRank){ ' +
  '        lastRank=CDAP_ROLE_RANK[u.role]; ' +
  '        var divider=document.createElement("tr"); ' +
  '        divider.innerHTML="<td colspan=\\"7\\" class=\\"cdap-section-divider\\">"+CDAP_ROLE_LABEL[u.role]+"s</td>"; ' +
  '        tbody.appendChild(divider); ' +
  '      } ' +
  '      var tr=document.createElement("tr"); ' +
  '      tr.innerHTML= ' +
  '        "<td><div class=\\"cdap-team-name-cell\\"><div class=\\"cdap-avatar\\">"+cdapInitials(u.name)+"</div>"+u.name+"</div></td>"+ ' +
  '        "<td>"+u.email+"</td>"+ ' +
  '        "<td>"+u.dept+"</td>"+ ' +
  '        "<td>"+u.office+"</td>"+ ' +
  '        "<td><span class=\\"cdap-role-pill "+u.role+"\\">"+CDAP_ROLE_LABEL[u.role]+"</span></td>"+ ' +
  '        "<td><button class=\\"cdap-btn-outline cdap-btn-sm\\">Reset password</button></td>"+ ' +
  '        "<td><button class=\\"cdap-btn-outline cdap-btn-sm\\">Edit</button></td>"; ' +
  '      tbody.appendChild(tr); ' +
  '    }); ' +
  '  } ' +
  ' ' +
  '  function renderFreqDays(){ ' +
  '    var grid=document.getElementById("cdapFreqDayGrid"); ' +
  '    if(!grid){return;} ' +
  '    var days=[]; ' +
  '    for(var i=0;i<30;i++){ days.push(i%7!==5&&i%7!==6); } ' +
  '    grid.innerHTML=""; ' +
  '    days.forEach(function(isOn,idx){ ' +
  '      var day=idx+1; ' +
  '      var chip=document.createElement("div"); ' +
  '      chip.className="cdap-freq-day-chip"+(isOn?" on":""); ' +
  '      chip.innerHTML="<span class=\\"cdap-freq-day-num\\">"+day+"</span>"+(isOn?"On":"Off"); ' +
  '      chip.addEventListener("click",function(){ ' +
  '        chip.classList.toggle("on"); ' +
  '        chip.innerHTML="<span class=\\"cdap-freq-day-num\\">"+day+"</span>"+(chip.classList.contains("on")?"On":"Off"); ' +
  '      }); ' +
  '      grid.appendChild(chip); ' +
  '    }); ' +
  '  } ' +
  ' ' +
  '  function populateEscalateAssignee(){ ' +
  '    var sel=document.getElementById("cdapEscalateAssignee"); ' +
  '    if(!sel){return;} ' +
  '    sel.innerHTML=CDAP_TEAM.filter(function(u){return u.role==="admin"||u.role==="manager";}).map(function(u){return "<option>"+u.name+"</option>";}).join(""); ' +
  '  } ' +
  ' ' +
  '  populateFilters(); ' +
  '  renderTeam(); ' +
  '  renderFreqDays(); ' +
  '  populateEscalateAssignee(); ' +
  '  ["cdapFilterOffice","cdapFilterDept","cdapFilterType"].forEach(function(id){ ' +
  '    document.getElementById(id).addEventListener("change",renderTeam); ' +
  '  }); ' +
  '}); ' +
  '})(); ' +
  '</script> ' +
  ' ';

function planForSize(size) {
  if (size === '1-10') return 'starter';
  if (size === '11-50') return 'growth';
  return 'enterprise';
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(function(b){ return b.toString(16).padStart(2, '0'); }).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = fromHex(saltHex);
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return toHex(bits);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes.buffer);
}

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return toHex(bytes.buffer);
}

function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  header.split(';').forEach(function(part) {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function slugify(name) {
  const s = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return s || 'company';
}

function emailDomain(email) {
  const parts = String(email).toLowerCase().split('@');
  return parts.length === 2 ? parts[1] : '';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function(c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE } });
}

function redirectTo(target) {
  const location = target.indexOf('http') === 0 ? target : (SITE_URL + target);
  return new Response(null, { status: 302, headers: { 'Location': location, 'Cache-Control': NO_STORE } });
}

async function injectHelpWidget(response, opts) {
  opts = opts || {};
  const contentType = response.headers.get('Content-Type') || '';
  if (contentType.indexOf('text/html') === -1) return response;
  return new HTMLRewriter()
    .on('body', {
      element: function(el) {
        el.append(HELP_WIDGET_HTML, { html: true });
        el.append(RESET_PASSWORD_SCRIPT, { html: true });
        el.append(DEMO_FIX_SCRIPT, { html: true });
        el.append(CONTACT_FORM_SCRIPT, { html: true });
        el.append(GET_STARTED_FORM_SCRIPT, { html: true });
        el.append(PRICING_LINKS_SCRIPT, { html: true });
        el.append(COMPARE_COPY_SCRIPT, { html: true });
        el.append(ROI_CALC_SCRIPT, { html: true });
        if (!opts.skipDemoPopup) { el.append(DEMO_POPUP_SCRIPT, { html: true }); }
      }
    })
    .on('#tiersRow', {
      element: function(el) {
        el.before(PROCESS_EXPLAINER_HTML, { html: true });
      }
    })
    .transform(response);
}

async function handleDemoDashboard(request, env) {
  const assetResponse = await env.ASSETS.fetch(new URL('/dashboard.html', request.url));
  const html = await assetResponse.text();
  const injected = html.indexOf('</body>') !== -1
    ? html.replace('</body>', DEMO_ACCOUNT_OVERLAY_SCRIPT + DEMO_TOUR_SCRIPT + DEMO_INTEGRATIONS_SEED_SCRIPT + '</body>')
    : html + DEMO_ACCOUNT_OVERLAY_SCRIPT + DEMO_TOUR_SCRIPT + DEMO_INTEGRATIONS_SEED_SCRIPT;
  return new Response(injected, {
    status: assetResponse.status,
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'public, max-age=300' }
  });
}

async function uniqueSlug(env, base) {
  let slug = base;
  let n = 1;
  while (true) {
    const row = await env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first();
    if (!row) return slug;
    n++;
    slug = base + '-' + n;
  }
}

async function sendEmail(env, opts) {
  const to = opts.to, subject = opts.subject, html = opts.html, kind = opts.kind, tenantId = opts.tenantId, userId = opts.userId, replyTo = opts.replyTo;
  if (!env.RESEND_API_KEY) {
    try {
      await env.DB.prepare(
        'INSERT INTO email_log (to_email, subject, kind, tenant_id, user_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(to, subject, kind, tenantId || null, userId || null, 'skipped', 'RESEND_API_KEY not configured').run();
    } catch (e) {}
    return { ok: false, skipped: true };
  }
  try {
    const payload = { from: FROM_EMAIL, to: [to], subject: subject, html: html };
    if (replyTo) payload.reply_to = replyTo;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const ok = res.ok;
    let errText = '';
    if (!ok) errText = await res.text();
    await env.DB.prepare(
      'INSERT INTO email_log (to_email, subject, kind, tenant_id, user_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(to, subject, kind, tenantId || null, userId || null, ok ? 'sent' : 'failed', ok ? null : errText.slice(0, 500)).run();
    return { ok: ok };
  } catch (e) {
    try {
      await env.DB.prepare(
        'INSERT INTO email_log (to_email, subject, kind, tenant_id, user_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(to, subject, kind, tenantId || null, userId || null, 'failed', String(e).slice(0, 500)).run();
    } catch (e2) {}
    return { ok: false, error: String(e) };
  }
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, u.role, u.tenant_id, u.status AS user_status, u.email_verified, ' +
    't.slug AS tenant_slug, t.company_name, t.status AS tenant_status, t.integration_status, ' +
    't.selected_plan, t.recommended_plan, t.stripe_customer_id, s.expires_at ' +
    'FROM sessions s ' +
    'JOIN users u ON u.id = s.user_id ' +
    'JOIN tenants t ON t.id = u.tenant_id ' +
    'WHERE s.token = ?'
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

async function handleSupportRequest(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body' }, 400); }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const message = (body.message || '').trim();
  const page = String(body.page || '').slice(0, 300);

  if (!name || !email || !message) {
    return json({ ok: false, error: 'Please fill out your name, email, and message.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }
  if (name.length > 200 || message.length > 4000) {
    return json({ ok: false, error: 'That message is too long.' }, 400);
  }

  const user = await getSessionUser(request, env);

  const notifyHtml =
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">' +
    '<h2>New support request</h2>' +
    '<table style="border-collapse:collapse;width:100%;">' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Name</td><td style="padding:4px 8px;">' + escapeHtml(name) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Email</td><td style="padding:4px 8px;">' + escapeHtml(email) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Page</td><td style="padding:4px 8px;">' + escapeHtml(page) + '</td></tr>' +
    (user ? '<tr><td style="padding:4px 8px;font-weight:600;">Logged in as</td><td style="padding:4px 8px;">' + escapeHtml(user.email) + ' (' + escapeHtml(user.company_name || '') + ')</td></tr>' : '') +
    '</table>' +
    '<p style="white-space:pre-wrap;padding:14px 16px;background:#F5F2EA;border-radius:8px;margin-top:14px;">' + escapeHtml(message) + '</p>' +
    '</div>';
  await sendEmail(env, {
    to: SUPPORT_EMAIL,
    subject: 'Support request from ' + name,
    html: notifyHtml,
    kind: 'support_request',
    replyTo: email,
    tenantId: user ? user.tenant_id : null,
    userId: user ? user.id : null
  });

  const confirmHtml =
    '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">' +
    '<h2 style="color:#171717;">We got your message</h2>' +
    '<p>Hi ' + escapeHtml(name) + ',</p>' +
    '<p>Thanks for reaching out to clAIms support. A member of our team will reply to this email within one business day.</p>' +
    '<p style="color:#666;font-size:13px;">Your message: &ldquo;' + escapeHtml(message.slice(0, 300)) + '&rdquo;</p>' +
    '</div>';
  await sendEmail(env, { to: email, subject: 'We got your message — clAIms support', html: confirmHtml, kind: 'support_confirmation' });

  return json({ ok: true, message: 'Thanks — we got your message.' });
}

async function handleForgotPassword(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body' }, 400); }

  const email = (body.email || '').trim().toLowerCase();
  const genericMessage = "If an account exists for that email, we've sent a reset link.";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE lower(email) = ?').bind(email).first();
  if (user) {
    const token = randomToken();
    const expires = new Date(Date.now() + RESET_TTL_SECONDS * 1000).toISOString();
    await env.DB.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').bind(token, expires, user.id).run();

    const resetUrl = SITE_URL + '/?reset_token=' + token + '#login';
    const resetHtml =
      '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">' +
      '<h2 style="color:#171717;">Reset your password</h2>' +
      '<p>Hi ' + escapeHtml(user.full_name || '') + ',</p>' +
      '<p>We received a request to reset the password for your clAIms account. Click below to choose a new password.</p>' +
      '<p style="margin:28px 0;"><a href="' + resetUrl + '" style="background:#171717;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Reset password</a></p>' +
      '<p style="color:#666;font-size:13px;">This link expires in 1 hour. If you did not request this, you can safely ignore this email — your password will not be changed.</p>' +
      '</div>';
    await sendEmail(env, {
      to: user.email,
      subject: 'Reset your clAIms password',
      html: resetHtml,
      kind: 'password_reset',
      tenantId: user.tenant_id,
      userId: user.id
    });
  }

  return json({ ok: true, message: genericMessage });
}

async function handleResetPassword(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body' }, 400); }

  const token = (body.token || '').trim();
  const password = body.password || '';
  const confirmPassword = body.confirmPassword || '';

  if (!token) {
    return json({ ok: false, error: 'Missing reset token.' }, 400);
  }
  if (!password || password.length < 8) {
    return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);
  }
  if (password !== confirmPassword) {
    return json({ ok: false, error: 'Passwords do not match.' }, 400);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE reset_token = ?').bind(token).first();
  if (!user) {
    return json({ ok: false, error: 'That reset link is invalid or has already been used.' }, 400);
  }
  if (!user.reset_expires || new Date(user.reset_expires) < new Date()) {
    return json({ ok: false, error: 'That reset link has expired. Please request a new one.' }, 400);
  }

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, salt = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?'
  ).bind(passwordHash, salt, user.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();

  return json({ ok: true, message: 'Password updated successfully.' });
}

async function handleSignup(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body' }, 400); }

  const fullName = (body.fullName || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const confirmPassword = body.confirmPassword || '';
  const companyName = (body.companyName || '').trim();
  const address = (body.address || '').trim();
  const city = (body.city || '').trim();
  const state = (body.state || '').trim();
  const zip = (body.zip || '').trim();
  const companySize = (body.companySize || '').trim();

  if (!fullName || !email || !password || !companyName || !companySize) {
    return json({ ok: false, error: 'Please fill out all required fields.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }
  if (password.length < 8) {
    return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);
  }
  if (password !== confirmPassword) {
    return json({ ok: false, error: 'Passwords do not match.' }, 400);
  }
  if (!body.agreeToTerms) {
    return json({ ok: false, error: 'You must agree to the Terms & Conditions to create an account.' }, 400);
  }

  const existingUser = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?').bind(email).first();
  if (existingUser) {
    return json({ ok: false, error: 'An account with this email already exists.' }, 409);
  }

  const domain = emailDomain(email);
  const isPersonalDomain = PERSONAL_EMAIL_DOMAINS.has(domain);

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  const verificationToken = randomToken();
  const verificationExpires = new Date(Date.now() + VERIFICATION_TTL_SECONDS * 1000).toISOString();

  let tenant = null;
  let isNewTenant = false;
  let userRole = 'admin';
  let userStatus = 'pending_verification';

  if (!isPersonalDomain) {
    tenant = await env.DB.prepare('SELECT * FROM tenants WHERE domain = ?').bind(domain).first();
  }

  if (tenant) {
    userRole = 'user';
    userStatus = 'pending_approval';
  } else {
    isNewTenant = true;
    const recommendedPlan = planForSize(companySize);
    const slug = await uniqueSlug(env, slugify(companyName));
    const insertTenant = await env.DB.prepare(
      "INSERT INTO tenants (slug, company_name, domain, address, city, state, zip, company_size, recommended_plan, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification')"
    ).bind(slug, companyName, isPersonalDomain ? null : domain, address, city, state, zip, companySize, recommendedPlan).run();
    const tenantId = insertTenant.meta.last_row_id;
    tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  }

  const acceptedAt = new Date().toISOString();
  const acceptedIp = request.headers.get('CF-Connecting-IP') || '';
  const insertUser = await env.DB.prepare(
    'INSERT INTO users (tenant_id, email, password_hash, salt, role, status, email_verified, verification_token, verification_expires, full_name, terms_accepted_at, terms_accepted_ip, terms_version) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)'
  ).bind(tenant.id, email, passwordHash, salt, userRole, userStatus, verificationToken, verificationExpires, fullName, acceptedAt, acceptedIp, 'v1').run();
  const userId = insertUser.meta.last_row_id;

  if (isNewTenant) {
    await env.DB.prepare('UPDATE tenants SET admin_user_id = ? WHERE id = ?').bind(userId, tenant.id).run();
  }

  const verifyUrl = SITE_URL + '/api/verify-email?token=' + verificationToken;
  const verifyHtml =
    '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">' +
    '<h2 style="color:#171717;">Verify your email</h2>' +
    '<p>Hi ' + escapeHtml(fullName) + ',</p>' +
    '<p>Thanks for signing up for clAIms' + (isNewTenant ? '' : ' — ' + escapeHtml(tenant.company_name)) + '. Click below to verify your email and continue setup.</p>' +
    '<p style="margin:28px 0;"><a href="' + verifyUrl + '" style="background:#171717;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Verify email</a></p>' +
    '<p style="color:#666;font-size:13px;">This link expires in 24 hours. If you did not request this, you can ignore this email.</p>' +
    '</div>';
  await sendEmail(env, { to: email, subject: 'Verify your email for clAIms', html: verifyHtml, kind: 'verify_email', tenantId: tenant.id, userId: userId });

  const notifyHtml =
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">' +
    '<h2>New Create Account submission</h2>' +
    '<table style="border-collapse:collapse;width:100%;">' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Full name</td><td style="padding:4px 8px;">' + escapeHtml(fullName) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Email</td><td style="padding:4px 8px;">' + escapeHtml(email) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Company</td><td style="padding:4px 8px;">' + escapeHtml(companyName) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Address</td><td style="padding:4px 8px;">' + escapeHtml(address) + ', ' + escapeHtml(city) + ', ' + escapeHtml(state) + ' ' + escapeHtml(zip) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Company size</td><td style="padding:4px 8px;">' + escapeHtml(companySize) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Recommended plan</td><td style="padding:4px 8px;">' + escapeHtml(tenant.recommended_plan || 'n/a') + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Signup type</td><td style="padding:4px 8px;">' + (isNewTenant ? 'New company (' + escapeHtml(tenant.slug) + ')' : 'Joined existing company: ' + escapeHtml(tenant.company_name) + ' (pending admin approval)') + '</td></tr>' +
    '</table>' +
    '</div>';
  await sendEmail(env, { to: NOTIFY_EMAIL, subject: 'New signup: ' + companyName + ' (' + email + ')', html: notifyHtml, kind: 'signup_notification', tenantId: tenant.id, userId: userId });

  return json({ ok: true, message: 'Check your email to verify your account.', joinedExisting: !isNewTenant });
}

async function handleGetStarted(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body' }, 400); }

  const fullName = (body.fullName || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const companyName = (body.companyName || '').trim();
  const address = (body.address || '').trim();
  const city = (body.city || '').trim();
  const state = (body.state || '').trim();
  const zip = (body.zip || '').trim();
  const companySize = (body.companySize || '').trim();
  const desiredPlan = (body.desiredPlan || '').trim();

  if (!fullName || !email || !companyName || !desiredPlan) {
    return json({ ok: false, error: 'Please fill out all required fields.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }
  if (['starter', 'growth', 'enterprise'].indexOf(desiredPlan) === -1) {
    return json({ ok: false, error: 'Please select a valid plan.' }, 400);
  }
  if (!body.agreeToTerms) {
    return json({ ok: false, error: 'You must agree to the Terms & Conditions to continue.' }, 400);
  }

  const notifyHtml =
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;">' +
    '<h2>New Get Started submission</h2>' +
    '<table style="border-collapse:collapse;width:100%;">' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Full name</td><td style="padding:4px 8px;">' + escapeHtml(fullName) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Email</td><td style="padding:4px 8px;">' + escapeHtml(email) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Company</td><td style="padding:4px 8px;">' + escapeHtml(companyName) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Address</td><td style="padding:4px 8px;">' + escapeHtml(address) + ', ' + escapeHtml(city) + ', ' + escapeHtml(state) + ' ' + escapeHtml(zip) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Company size</td><td style="padding:4px 8px;">' + escapeHtml(companySize) + '</td></tr>' +
    '<tr><td style="padding:4px 8px;font-weight:600;">Desired plan</td><td style="padding:4px 8px;">' + escapeHtml(desiredPlan) + '</td></tr>' +
    '</table>' +
    '</div>';
  const result = await sendEmail(env, {
    to: 'info@claims-collection.net',
    subject: 'NEW CUSTOMER ' + companyName,
    html: notifyHtml,
    kind: 'get_started_lead'
  });

  return json({ ok: true, message: 'Thanks — our team will be in touch shortly.', emailSent: !!result.ok });
}

async function handleThankYou(request, env) {
  return injectHelpWidget(new Response(THANK_YOU_HTML, { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': NO_STORE } }));
}

async function handleAccountPage(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': new URL('/', request.url).toString() + '?login=1', 'Cache-Control': NO_STORE }
    });
  }
  return injectHelpWidget(new Response(ACCOUNT_PAGE_HTML, { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': NO_STORE } }), { skipDemoPopup: true });
}

const SUBSCRIPTION_PAGE_HTML = `<!doctype html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manage Subscription — clAIms</title>
<link rel="icon" href="/favicon.ico">
<style>
*{box-sizing:border-box;}
body{margin:0;font-family:"IBM Plex Sans",Arial,sans-serif;background:#F5F2EA;color:#171717;}
.sub-topbar{background:#171717;color:#fff;padding:16px 28px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.sub-brand{font-weight:700;font-size:18px;letter-spacing:.02em;}
.sub-back{color:#D8D4C8;text-decoration:none;font-size:13.5px;font-weight:600;}
.sub-back:hover{color:#fff;}
.sub-wrap{max-width:760px;margin:0 auto;padding:32px 24px 80px;}
.sub-wrap h1{font-size:22px;margin:0 0 6px;}
.sub-wrap .sub-lede{color:#615D53;font-size:13.5px;margin:0 0 24px;}
.sub-card{background:#fff;border:1px solid #E5E0D2;border-radius:14px;padding:22px 24px;margin-bottom:18px;box-shadow:0 12px 30px -18px rgba(23,23,23,0.15);}
.sub-card h3{margin:0 0 4px;font-size:16px;}
.sub-card .sub-card-sub{font-size:12.5px;color:#615D53;margin-bottom:16px;}
.plan-banner{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;background:#171717;color:#fff;border-radius:14px;padding:20px 24px;margin-bottom:18px;}
.plan-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#B7BCD4;font-weight:700;}
.plan-name{font-size:22px;font-weight:700;margin-top:4px;}
.plan-feature-list{margin:0;padding-left:20px;}
.plan-feature-list li{font-size:13.5px;color:#3B3A35;margin-bottom:7px;line-height:1.5;}
.btn-dark{background:#171717;color:#fff;border:none;font-weight:600;font-size:13px;padding:10px 18px;border-radius:8px;cursor:pointer;}
.btn-dark:hover{opacity:.88;}
.btn-dark:disabled{opacity:.5;cursor:default;}
.btn-outline{background:none;color:#171717;border:1.5px solid #E5E0D2;font-weight:600;font-size:13px;padding:9px 17px;border-radius:8px;cursor:pointer;}
.btn-outline:hover{border-color:#C29B57;color:#C29B57;}
.btn-rust{background:#B23A2E;color:#fff;border:none;font-weight:600;font-size:13px;padding:10px 18px;border-radius:8px;cursor:pointer;}
.btn-rust:hover{opacity:.88;}
.sub-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;}
.sub-banner{border-radius:12px;padding:16px 18px;font-size:13.5px;line-height:1.6;margin-bottom:18px;}
.sub-banner.warn{background:#FCEFD9;color:#7A4E12;border:1px solid #EEDDB6;}
.sub-banner.info{background:#EFE7F6;color:#4A2E70;border:1px solid #DFD0F0;}
.sub-banner.err{background:#F7E2DF;color:#6E3B3B;border:1px solid #EBC7C0;}
.sub-restricted{background:#FBFAF6;border:1px dashed #E5E0D2;border-radius:12px;padding:32px 24px;text-align:center;color:#8A8578;font-size:13.5px;line-height:1.6;}
.sub-modal-backdrop{position:fixed;inset:0;background:rgba(23,23,23,0.55);display:none;align-items:center;justify-content:center;z-index:999;padding:20px;}
.sub-modal-backdrop.open{display:flex;}
.sub-modal{background:#fff;border-radius:14px;padding:26px;max-width:420px;width:100%;}
.sub-modal h4{margin:0 0 10px;}
.sub-modal p{font-size:13.5px;color:#3B3A35;line-height:1.6;margin:0 0 16px;}
.sub-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:6px;}
.sub-note{font-size:11.5px;color:#8A8578;margin-top:10px;line-height:1.5;}
.sub-loading{color:#8A8578;font-size:13.5px;padding:40px 0;text-align:center;}
</style></head><body>
<div class="sub-topbar">
<div class="sub-brand">clAIms</div>
<a class="sub-back" href="/account">&larr; Back to Account</a>
</div>
<div class="sub-wrap" id="subWrap">
<div class="sub-loading">Loading your subscription…</div>
</div>

<div class="sub-modal-backdrop" id="cancelModalBackdrop">
<div class="sub-modal">
<h4>Cancel subscription?</h4>
<p id="cancelModalText">Your plan will stay active through the end of the current billing period. After that, it will not renew and your team will lose access to clAIms.</p>
<div class="sub-modal-actions">
<button class="btn-outline" id="cancelModalNo">Never mind</button>
<button class="btn-rust" id="cancelModalYes">Cancel subscription</button>
</div>
</div>
</div>

<div class="sub-modal-backdrop" id="upgradeModalBackdrop">
<div class="sub-modal">
<h4>Request an upgrade</h4>
<p id="upgradeModalText">We'll notify your clAIms account team to upgrade your plan and handle proration on your next invoice. They'll follow up by email shortly.</p>
<div class="sub-modal-actions">
<button class="btn-outline" id="upgradeModalNo">Never mind</button>
<button class="btn-dark" id="upgradeModalYes">Send request</button>
</div>
</div>
</div>

<script>
(function(){
function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}
var PLAN_FEATURES={
  starter:{name:"Starter",next:"growth",features:["2–3 user seats","1 integration","Autonomous cadence & AI drafting","A/R spreadsheet & aging reports","Email support"]},
  growth:{name:"Growth",next:"enterprise",features:["5–8 user seats","QuickBooks, Dash, Salesforce, NetSuite, and more","Everything in Starter","Invoiced MTD & Collected reporting by office","Priority support"]},
  enterprise:{name:"Enterprise",next:null,features:["Unlimited seats","All integrations","Everything in Growth","Multi-office & multi-entity support","Dedicated account manager"]}
};
function fmtDate(iso){
  if(!iso) return null;
  try{ var d=new Date(iso); return d.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}); }catch(e){ return null; }
}
ready(function(){
  var wrap=document.getElementById("subWrap");
  var me=null, subInfo=null;

  fetch("/api/me",{credentials:"same-origin"}).then(function(r){return r.json();}).then(function(data){
    if(!data||!data.ok){ window.location.href="/?login=1"; return; }
    if(data.role!=="admin"){ window.location.href="/account"; return; }
    me=data;
    return fetch("/api/subscription",{credentials:"same-origin"}).then(function(r){return r.json();});
  }).then(function(info){
    if(!info) return;
    if(!info.ok){ wrap.innerHTML="<div class=\\"sub-banner err\\">We couldn't load your subscription right now. Please refresh, or contact us if this keeps happening.</div>"; return; }
    subInfo=info;
    render();
  }).catch(function(){
    wrap.innerHTML="<div class=\\"sub-banner err\\">We couldn't load your subscription right now. Please refresh, or contact us if this keeps happening.</div>";
  });

  function render(){
    var plan=subInfo.plan||"growth";
    var info=PLAN_FEATURES[plan]||PLAN_FEATURES.growth;
    var isEnterprise=(plan==="enterprise");
    var sub=subInfo.subscription;
    var html="";

    html+="<h1>Manage Subscription</h1><p class=\\"sub-lede\\">Review your plan, update it, or cancel future billing.</p>";

    if(sub&&sub.cancelAtPeriodEnd){
      var d=fmtDate(sub.currentPeriodEnd);
      html+="<div class=\\"sub-banner warn\\">Your subscription is set to cancel"+(d?(" on <b>"+d+"</b>"):"")+". You'll keep access until then. Changed your mind? <button class=\\"btn-outline\\" id=\\"reactivateBtn\\" style=\\"margin-left:8px;\\">Keep my subscription</button></div>";
    }

    html+="<div class=\\"plan-banner\\"><div><div class=\\"plan-label\\">Current plan</div><div class=\\"plan-name\\">"+info.name+"</div></div></div>";

    html+="<div class=\\"sub-card\\"><h3>Plan features</h3><ul class=\\"plan-feature-list\\">"+info.features.map(function(f){return "<li>"+f+"</li>";}).join("")+"</ul></div>";

    if(!subInfo.hasBilling){
      html+="<div class=\\"sub-banner info\\">No billing account is on file for this company yet, so there's nothing to cancel. Once you complete checkout, you'll be able to manage your subscription here.</div>";
    } else if(isEnterprise){
      html+="<div class=\\"sub-restricted\\">Enterprise plans are managed by your dedicated account team. <a href=\\"mailto:hndrx@claims-collection.net\\">Contact us</a> to make changes to your plan.</div>";
    } else {
      html+="<div class=\\"sub-actions\\">";
      if(info.next){
        html+="<button class=\\"btn-dark\\" id=\\"upgradeBtn\\">Upgrade to "+(PLAN_FEATURES[info.next]?PLAN_FEATURES[info.next].name:"the next plan")+"</button>";
      }
      if(!(sub&&sub.cancelAtPeriodEnd)){
        html+="<button class=\\"btn-outline\\" id=\\"cancelBtn\\">Cancel subscription</button>";
      }
      html+="</div>";
      html+="<div class=\\"sub-note\\">Cancelling stops your next automatic payment. Your plan stays active through the end of the current billing period.</div>";
    }

    wrap.innerHTML=html;
    wireActions();
  }

  function wireActions(){
    var cancelBtn=document.getElementById("cancelBtn");
    var upgradeBtn=document.getElementById("upgradeBtn");
    var reactivateBtn=document.getElementById("reactivateBtn");
    if(cancelBtn){ cancelBtn.addEventListener("click",function(){ openModal("cancelModalBackdrop"); }); }
    if(upgradeBtn){ upgradeBtn.addEventListener("click",function(){ openModal("upgradeModalBackdrop"); }); }
    if(reactivateBtn){ reactivateBtn.addEventListener("click",function(){ doReactivate(reactivateBtn); }); }
  }

  function openModal(id){ document.getElementById(id).classList.add("open"); }
  function closeModal(id){ document.getElementById(id).classList.remove("open"); }

  document.getElementById("cancelModalNo").addEventListener("click",function(){ closeModal("cancelModalBackdrop"); });
  document.getElementById("upgradeModalNo").addEventListener("click",function(){ closeModal("upgradeModalBackdrop"); });

  document.getElementById("cancelModalYes").addEventListener("click",function(){
    var btn=document.getElementById("cancelModalYes");
    btn.disabled=true; btn.textContent="Cancelling…";
    fetch("/api/subscription/cancel",{method:"POST",credentials:"same-origin"}).then(function(r){return r.json();}).then(function(res){
      btn.disabled=false; btn.textContent="Cancel subscription";
      closeModal("cancelModalBackdrop");
      if(res&&res.ok){
        subInfo.subscription=subInfo.subscription||{};
        subInfo.subscription.cancelAtPeriodEnd=true;
        subInfo.subscription.currentPeriodEnd=res.cancelAt;
        render();
      } else {
        alert((res&&res.error)||"We couldn't cancel your subscription. Please try again or contact us.");
      }
    }).catch(function(){
      btn.disabled=false; btn.textContent="Cancel subscription";
      alert("We couldn't cancel your subscription. Please try again or contact us.");
    });
  });

  document.getElementById("upgradeModalYes").addEventListener("click",function(){
    var btn=document.getElementById("upgradeModalYes");
    btn.disabled=true; btn.textContent="Sending…";
    fetch("/api/subscription/upgrade-request",{method:"POST",credentials:"same-origin"}).then(function(r){return r.json();}).then(function(res){
      btn.disabled=false; btn.textContent="Send request";
      closeModal("upgradeModalBackdrop");
      if(res&&res.ok){
        alert("Request sent — our team will follow up by email to complete your upgrade.");
      } else {
        alert((res&&res.error)||"We couldn't send your upgrade request. Please email us directly.");
      }
    }).catch(function(){
      btn.disabled=false; btn.textContent="Send request";
      alert("We couldn't send your upgrade request. Please email us directly.");
    });
  });

  function doReactivate(btn){
    btn.disabled=true; btn.textContent="Restoring…";
    fetch("/api/subscription/reactivate",{method:"POST",credentials:"same-origin"}).then(function(r){return r.json();}).then(function(res){
      if(res&&res.ok){
        subInfo.subscription.cancelAtPeriodEnd=false;
        render();
      } else {
        btn.disabled=false; btn.textContent="Keep my subscription";
        alert((res&&res.error)||"We couldn't undo the cancellation. Please contact us.");
      }
    }).catch(function(){
      btn.disabled=false; btn.textContent="Keep my subscription";
      alert("We couldn't undo the cancellation. Please contact us.");
    });
  }
});
})();
<\/script>
</body></html>`;

async function stripeRequest(env, method, path, params) {
  if (!env.STRIPE_SECRET_KEY) return { ok: false, error: 'Stripe is not configured for this environment.' };
  const opts = { method: method, headers: { 'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY } };
  let url = 'https://api.stripe.com/v1' + path;
  if (params) {
    const form = new URLSearchParams();
    Object.keys(params).forEach(function (k) { if (params[k] !== undefined && params[k] !== null) form.append(k, params[k]); });
    if (method === 'GET') {
      url += '?' + form.toString();
    } else {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = form.toString();
    }
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) return { ok: false, error: (data && data.error && data.error.message) || 'Stripe request failed.', status: res.status };
  return { ok: true, data: data };
}

async function getActiveStripeSubscription(env, customerId) {
  const active = await stripeRequest(env, 'GET', '/subscriptions', { customer: customerId, status: 'active', limit: 1 });
  if (!active.ok) return active;
  if (active.data.data && active.data.data[0]) return { ok: true, data: active.data.data[0] };
  const trialing = await stripeRequest(env, 'GET', '/subscriptions', { customer: customerId, status: 'trialing', limit: 1 });
  if (trialing.ok && trialing.data.data && trialing.data.data[0]) return { ok: true, data: trialing.data.data[0] };
  return { ok: true, data: null };
}

async function handleSubscriptionInfo(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false }, 401);
  if (user.role !== 'admin') return json({ ok: false, error: 'Admins only' }, 403);
  const plan = user.selected_plan || user.recommended_plan || 'growth';
  if (!user.stripe_customer_id) {
    return json({ ok: true, plan: plan, hasBilling: false, subscription: null });
  }
  const subResult = await getActiveStripeSubscription(env, user.stripe_customer_id);
  if (!subResult.ok) return json({ ok: true, plan: plan, hasBilling: true, subscription: null, stripeError: subResult.error });
  const sub = subResult.data;
  return json({
    ok: true,
    plan: plan,
    hasBilling: true,
    subscription: sub ? {
      status: sub.status,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null
    } : null
  });
}

async function handleSubscriptionCancel(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false }, 401);
  if (user.role !== 'admin') return json({ ok: false, error: 'Admins only' }, 403);
  const plan = user.selected_plan || user.recommended_plan || 'growth';
  if (plan === 'enterprise') return json({ ok: false, error: 'Enterprise plans are managed by your account team. Please contact us to make changes.' }, 400);
  if (!user.stripe_customer_id) return json({ ok: false, error: 'No billing account on file for this company yet.' }, 400);
  const subResult = await getActiveStripeSubscription(env, user.stripe_customer_id);
  if (!subResult.ok) return json({ ok: false, error: subResult.error }, 502);
  if (!subResult.data) return json({ ok: false, error: 'No active subscription found to cancel.' }, 404);
  const upd = await stripeRequest(env, 'POST', '/subscriptions/' + subResult.data.id, { cancel_at_period_end: 'true' });
  if (!upd.ok) return json({ ok: false, error: upd.error }, 502);
  const cancelAt = upd.data.current_period_end ? new Date(upd.data.current_period_end * 1000).toISOString() : null;
  try {
    await sendEmail(env, {
      to: NOTIFY_EMAIL,
      subject: 'Subscription cancellation requested: ' + (user.company_name || ''),
      html: '<p>' + escapeHtml(user.company_name || '') + ' (' + escapeHtml(user.email) + ') scheduled their subscription to cancel at the end of the current billing period' + (cancelAt ? (' (' + escapeHtml(cancelAt) + ')') : '') + '.</p>',
      kind: 'subscription_cancel',
      tenantId: user.tenant_id,
      userId: user.id
    });
  } catch (e) {}
  return json({ ok: true, cancelAt: cancelAt });
}

async function handleSubscriptionReactivate(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false }, 401);
  if (user.role !== 'admin') return json({ ok: false, error: 'Admins only' }, 403);
  if (!user.stripe_customer_id) return json({ ok: false, error: 'No billing account on file for this company yet.' }, 400);
  const subResult = await getActiveStripeSubscription(env, user.stripe_customer_id);
  if (!subResult.ok) return json({ ok: false, error: subResult.error }, 502);
  if (!subResult.data) return json({ ok: false, error: 'No active subscription found.' }, 404);
  const upd = await stripeRequest(env, 'POST', '/subscriptions/' + subResult.data.id, { cancel_at_period_end: 'false' });
  if (!upd.ok) return json({ ok: false, error: upd.error }, 502);
  return json({ ok: true });
}

async function handleSubscriptionUpgradeRequest(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ ok: false }, 401);
  if (user.role !== 'admin') return json({ ok: false, error: 'Admins only' }, 403);
  const plan = user.selected_plan || user.recommended_plan || 'growth';
  if (plan === 'enterprise') return json({ ok: false, error: 'You are already on the Enterprise plan.' }, 400);
  try {
    await sendEmail(env, {
      to: NOTIFY_EMAIL,
      subject: 'Upgrade requested: ' + (user.company_name || ''),
      html: '<p>' + escapeHtml(user.company_name || '') + ' (' + escapeHtml(user.email) + ') requested an upgrade from their current plan (' + escapeHtml(plan) + ') via the account portal.</p>',
      kind: 'subscription_upgrade_request',
      tenantId: user.tenant_id,
      userId: user.id,
      replyTo: user.email
    });
  } catch (e) {
    return json({ ok: false, error: 'Could not send upgrade request. Please email us directly.' }, 502);
  }
  return json({ ok: true });
}

async function handleSubscriptionPage(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': new URL('/', request.url).toString() + '?login=1', 'Cache-Control': NO_STORE }
    });
  }
  return injectHelpWidget(new Response(SUBSCRIPTION_PAGE_HTML, { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': NO_STORE } }), { skipDemoPopup: true });
}

async function handleVerifyEmail(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  if (!token) return redirectTo('/?verify=missing');

  const user = await env.DB.prepare('SELECT * FROM users WHERE verification_token = ?').bind(token).first();
  if (!user) return redirectTo('/?verify=invalid');
  if (user.verification_expires && new Date(user.verification_expires) < new Date()) {
    return redirectTo('/?verify=expired');
  }

  await env.DB.prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?').bind(user.id).run();

  const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(user.tenant_id).first();

  if (tenant && user.role === 'admin' && tenant.admin_user_id === user.id) {
    const plan = tenant.recommended_plan || 'starter';
    const link = STRIPE_LINKS[plan];
    if (!link) {
      await env.DB.prepare("UPDATE tenants SET status = 'verified' WHERE id = ?").bind(tenant.id).run();
      return redirectTo('/?verify=enterprise');
    }
    await env.DB.prepare("UPDATE tenants SET status = 'payment_pending' WHERE id = ?").bind(tenant.id).run();
    const paymentUrl = link + '?prefilled_email=' + encodeURIComponent(user.email) + '&client_reference_id=' + tenant.id;
    return redirectTo(paymentUrl);
  }

  return redirectTo('/?verify=pending-approval');
}

async function handlePendingApprovals(request, env) {
  const admin = await getSessionUser(request, env);
  if (!admin || admin.role !== 'admin') return json({ ok: false, error: 'Not authorized' }, 403);
  const results = await env.DB.prepare(
    "SELECT id, email, full_name, status, created_at FROM users WHERE tenant_id = ? AND status = 'pending_approval'"
  ).bind(admin.tenant_id).all();
  return json({ ok: true, pending: results.results });
}

async function handleApproveUser(request, env) {
  const admin = await getSessionUser(request, env);
  if (!admin || admin.role !== 'admin') return json({ ok: false, error: 'Not authorized' }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid body' }, 400); }
  const targetId = body.userId;
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').bind(targetId, admin.tenant_id).first();
  if (!target) return json({ ok: false, error: 'User not found' }, 404);
  await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(targetId).run();
  return json({ ok: true });
}

async function handleRejectUser(request, env) {
  const admin = await getSessionUser(request, env);
  if (!admin || admin.role !== 'admin') return json({ ok: false, error: 'Not authorized' }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid body' }, 400); }
  const targetId = body.userId;
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').bind(targetId, admin.tenant_id).first();
  if (!target) return json({ ok: false, error: 'User not found' }, 404);
  await env.DB.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").bind(targetId).run();
  return json({ ok: true });
}

async function verifyStripeSignature(env, sigHeader, rawBody) {
  if (!env.STRIPE_WEBHOOK_SECRET) return false;
  const parts = {};
  sigHeader.split(',').forEach(function(p) {
    const idx = p.indexOf('=');
    if (idx === -1) return;
    parts[p.slice(0, idx)] = p.slice(idx + 1);
  });
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;
  const signedPayload = timestamp + '.' + rawBody;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
  const expected = toHex(sigBuf);
  return expected === v1;
}

async function handleStripeWebhook(request, env) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get('Stripe-Signature') || '';
  const valid = await verifyStripeSignature(env, sigHeader, rawBody);
  if (!valid) {
    return new Response('Invalid signature', { status: 400 });
  }
  let event;
  try { event = JSON.parse(rawBody); } catch (e) { return new Response('Bad payload', { status: 400 }); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const tenantId = session.client_reference_id;
    if (tenantId) {
      await env.DB.prepare(
        "UPDATE tenants SET status = 'active', integration_status = 'not_started', stripe_customer_id = ? WHERE id = ?"
      ).bind(session.customer || null, tenantId).run();
      await env.DB.prepare(
        "UPDATE users SET status = 'active' WHERE tenant_id = ? AND role = 'admin'"
      ).bind(tenantId).run();

      const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
      if (tenant) {
        const notifyHtml = '<div style="font-family:sans-serif;"><h2>Payment received</h2><p>' + escapeHtml(tenant.company_name) + ' has completed payment and is now active. Plan: ' + escapeHtml(tenant.selected_plan || tenant.recommended_plan || 'n/a') + '.</p></div>';
        await sendEmail(env, { to: NOTIFY_EMAIL, subject: 'Payment received: ' + tenant.company_name, html: notifyHtml, kind: 'payment_received', tenantId: tenant.id });
      }
    }
  }

  return new Response('ok', { status: 200 });
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Invalid request body' }, 400);
  }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) {
    return json({ ok: false, error: 'Email and password are required' }, 400);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE lower(email) = ?').bind(email).first();
  if (!user) {
    return json({ ok: false, error: 'Invalid email or password' }, 401);
  }

  const computedHash = await hashPassword(password, user.salt);
  if (computedHash !== user.password_hash) {
    return json({ ok: false, error: 'Invalid email or password' }, 401);
  }

  if (!user.email_verified) {
    return json({ ok: false, error: 'Please verify your email before logging in. Check your inbox for the verification link.' }, 403);
  }
  if (user.status === 'pending_approval') {
    return json({ ok: false, error: "Your account is pending approval from your company's admin." }, 403);
  }
  if (user.status === 'rejected') {
    return json({ ok: false, error: 'Your access request was declined. Contact your company admin.' }, 403);
  }

  const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(user.tenant_id).first();
  if (tenant && user.role === 'admin' && (tenant.status === 'verified' || tenant.status === 'payment_pending')) {
    const plan = tenant.recommended_plan || 'starter';
    const link = STRIPE_LINKS[plan];
    if (link) {
      const paymentUrl = link + '?prefilled_email=' + encodeURIComponent(user.email) + '&client_reference_id=' + tenant.id;
      return json({ ok: false, error: 'Your company account is verified — finish payment to activate it.', redirect: paymentUrl }, 403);
    }
    return json({ ok: false, error: 'Your plan requires a custom quote. Our team will reach out shortly, or contact hndrx@claims-collection.net.' }, 403);
  }
  if (tenant && tenant.status !== 'active' && user.role !== 'admin') {
    return json({ ok: false, error: "Your company's account setup is not finished yet. Please contact your admin." }, 403);
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, user.id, expiresAt).run();

  const cookie = SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_TTL_SECONDS;
  return new Response(JSON.stringify({ ok: true, redirect: '/account' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie, 'Cache-Control': NO_STORE }
  });
}

async function handleLogout(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  const cookie = SESSION_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  return new Response(JSON.stringify({ ok: true, redirect: '/' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie, 'Cache-Control': NO_STORE }
  });
}

const MY_ACCOUNT_LINK_SCRIPT = '<script>' +
'(function(){' +
'function ready(fn){if(document.readyState!=="loading"){fn();}else{document.addEventListener("DOMContentLoaded",fn);}}' +
'ready(function(){' +
'var wrap=document.getElementById("gh-account");' +
'if(wrap){wrap.style.display="flex";}' +
'var btn=document.getElementById("gh-logout-btn");' +
'if(btn){btn.addEventListener("click",function(){' +
'btn.disabled=true;' +
'fetch("/api/logout",{method:"POST",credentials:"same-origin"}).then(function(){window.location.href="/";}).catch(function(){window.location.href="/";});' +
'});}' +
'});' +
'})();' +
'<' + '/script>';

async function handleDashboard(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': new URL('/', request.url).toString() + '?login=1', 'Cache-Control': NO_STORE }
    });
  }
  const assetResponse = await env.ASSETS.fetch(new URL('/dashboard.html', request.url));
  let html = await assetResponse.text();
  const safeName = String(user.company_name || '').replace(/"/g, '&quot;');
  html = html
    .replace(/data-company-name="[^"]*"/, 'data-company-name="' + safeName + '"')
    .replace(/data-tenant-slug="[^"]*"/, 'data-tenant-slug="' + user.tenant_slug + '"')
    .replace('</body>', MY_ACCOUNT_LINK_SCRIPT + '</body>');
  return injectHelpWidget(new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': NO_STORE } }), { skipDemoPopup: true });
}

async function handleMe(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) {
    return json({ ok: false }, 401);
  }
  return json({
    ok: true,
    email: user.email,
    role: user.role,
    tenant: user.tenant_slug,
    companyName: user.company_name,
    tenantStatus: user.tenant_status,
    integrationStatus: user.integration_status,
    selectedPlan: user.selected_plan,
    recommendedPlan: user.recommended_plan,
    hasBilling: !!user.stripe_customer_id
  });
}

async function handleAdminAccountsExport(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || request.headers.get('X-Export-Key') || '';
  if (!env.ADMIN_EXPORT_KEY || key !== env.ADMIN_EXPORT_KEY) {
    return json({ ok: false, error: 'Not authorized' }, 401);
  }
  const results = await env.DB.prepare(
    `SELECT t.id AS tenant_id, t.slug, t.company_name, t.created_at AS company_created_at, t.domain, t.address, t.city, t.state, t.zip, t.country, t.company_size, t.recommended_plan, t.selected_plan, t.status AS tenant_status, t.integration_status,
            u.id AS user_id, u.email, u.full_name, u.role AS user_role, u.status AS user_status, u.email_verified, u.created_at AS user_created_at
     FROM tenants t
     LEFT JOIN users u ON u.tenant_id = t.id
     ORDER BY t.id, u.id`
  ).all();
  return new Response(JSON.stringify({ ok: true, generated_at: new Date().toISOString(), rows: results.results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE, 'Access-Control-Allow-Origin': '*' }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }
    if (url.pathname === '/api/me' && request.method === 'GET') {
      return handleMe(request, env);
    }
    if (url.pathname === '/api/admin/accounts-export' && request.method === 'GET') {
      return handleAdminAccountsExport(request, env);
    }
    if (url.pathname === '/api/signup' && request.method === 'POST') {
      return handleSignup(request, env);
    }
    if (url.pathname === '/api/verify-email' && request.method === 'GET') {
      return handleVerifyEmail(request, env);
    }
    if (url.pathname === '/api/pending-approvals' && request.method === 'GET') {
      return handlePendingApprovals(request, env);
    }
    if (url.pathname === '/api/approve-user' && request.method === 'POST') {
      return handleApproveUser(request, env);
    }
    if (url.pathname === '/api/reject-user' && request.method === 'POST') {
      return handleRejectUser(request, env);
    }
    if (url.pathname === '/api/support' && request.method === 'POST') {
      return handleSupportRequest(request, env);
    }
    if (url.pathname === '/api/forgot-password' && request.method === 'POST') {
      return handleForgotPassword(request, env);
    }
    if (url.pathname === '/api/reset-password' && request.method === 'POST') {
      return handleResetPassword(request, env);
    }
    if (url.pathname === '/api/demo-dashboard' && request.method === 'GET') {
      return handleDemoDashboard(request, env);
    }
    if (url.pathname === '/api/get-started' && request.method === 'POST') {
      return handleGetStarted(request, env);
    }
    if (url.pathname === '/thank-you' && request.method === 'GET') {
      return handleThankYou(request, env);
    }
    if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') {
      return handleStripeWebhook(request, env);
    }
    if (url.pathname === '/account') {
      return handleAccountPage(request, env);
    }
    if (url.pathname === '/account/subscription') {
      return handleSubscriptionPage(request, env);
    }
    if (url.pathname === '/api/subscription' && request.method === 'GET') {
      return handleSubscriptionInfo(request, env);
    }
    if (url.pathname === '/api/subscription/cancel' && request.method === 'POST') {
      return handleSubscriptionCancel(request, env);
    }
    if (url.pathname === '/api/subscription/reactivate' && request.method === 'POST') {
      return handleSubscriptionReactivate(request, env);
    }
    if (url.pathname === '/api/subscription/upgrade-request' && request.method === 'POST') {
      return handleSubscriptionUpgradeRequest(request, env);
    }
    if (url.pathname === '/dashboard') {
      return handleDashboard(request, env);
    }
    if (url.pathname === '/dashboard.html') {
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/dashboard', 'Cache-Control': NO_STORE }
      });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    return injectHelpWidget(assetResponse);
  }
};

// redeploy trigger
