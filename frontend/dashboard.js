// Display user's first name
const currentUser = JSON.parse(localStorage.getItem('currentUser'));
if(currentUser && currentUser.fullName){
    const firstName = currentUser.fullName.split(' ')[0];
    const userWelcome = document.getElementById('userWelcome');
    if(userWelcome){
        userWelcome.textContent = 'Welcome, ' + firstName;
    }
}

function startTimers(){
    const timers=document.querySelectorAll(".timer");
    
    timers.forEach(timer=>{
        let time=parseInt(timer.getAttribute("data-time"));
        
        function update(){
            let hours=Math.floor(time/3600);
            let minutes=Math.floor((time%3600)/60);
            let seconds=time%60;
            
            timer.innerHTML="SLA Countdown: "+hours+"h "+minutes+"m "+seconds+"s";
            
            if(time>0){
                time--;
            }
        }
        
        update();
        setInterval(update,1000);
    });
}

startTimers();
