let AWS = require('aws-sdk');
let ec2 = new AWS.EC2();
let cw = new AWS.CloudWatch();

exports.handler = async (event) => {
    var instances_description = await describeAllInstances();
    var dashboard_template = await buildDashboardTemplate(instances_description.Instances);
    await createDashboard(dashboard_template, process.env.dashboard_name);
    
    const response = {
        statusCode: 200, 
        //body: instances_description
    };
    
    return response;
};

function getMaxNumberOfVolumesPerInstance(instances) {
    var max_number_of_volumes_per_instance = 1;
    
    for (var i = 0; i < instances.length; i++) {
        var current_number_of_volumes_per_instance = instances[i].Volumes.length;
        if(current_number_of_volumes_per_instance > max_number_of_volumes_per_instance) {
            max_number_of_volumes_per_instance = current_number_of_volumes_per_instance;
        }
    }
    
    return max_number_of_volumes_per_instance;
}

async function buildDashboardTemplate(instances) {
    process.env.widget_base_height = process.env.widget_min_height * getMaxNumberOfVolumesPerInstance(instances);
    var dashboard = {};
    dashboard.widgets = [];
    
    for (var i = 0; i < instances.length; i++) {
        dashboard.widgets.push(getCPUUtilizationTemplate(i, instances[i].InstanceId, instances[i].InstanceName));
        for (var j = 0; j < instances[i].Volumes.length; j++) {
            dashboard.widgets.push(getVolumesBandwithTemplate(i, j, instances[i].Volumes.length, instances[i].Volumes[j]));
        }
    }
    
    return dashboard;
}

async function createDashboard(dashboard_templae, dashboard_name) {
    var params = {
        DashboardBody: JSON.stringify(dashboard_templae),
        DashboardName: dashboard_name
    };
    
    await cw.putDashboard(params).promise();
}

function getCPUUtilizationTemplate(row_ix, instance_id, instance_name) {
    var width = parseInt(process.env.widget_width);
    var height = parseInt(process.env.widget_base_height);
    
    var template = {
                        "type": "metric",
                        "x": 0,
                        "y": height * row_ix,
                        "width": width,
                        "height": height,
                        "properties": {
                            "metrics": [
                                [ "AWS/EC2", "CPUUtilization", "InstanceId", ""+instance_id, { "period": 60 } ]
                            ],
                            "view": "timeSeries",
                            "stacked": false,
                            "region": "eu-west-1",
                            "title": "CPU Utilization " + instance_name + " (" + instance_id + ")",
                            "period": 300
                        }
                    };
    
    return template;
}

function getVolumesBandwithTemplate(row_ix, sub_row_ix, sub_row_num, volume_id) {
    var width = parseInt(process.env.widget_width);
    var base_height = parseInt(process.env.widget_base_height);
    
    // calculate real height and y (useful if more than one volume per instance)
    var real_height = base_height/sub_row_num;
    var y_step = (row_ix*base_height)+(sub_row_ix*real_height);
    
    var template = {
                        "type": "metric",
                        "x": width,
                        "y": y_step,
                        "width": width,
                        "height": real_height,
                        "properties": {
                            "metrics": [
                                [ "AWS/EBS", "VolumeWriteBytes", "VolumeId", volume_id, { "stat": "Sum", "period": 300 } ],
                                [ ".", "VolumeReadBytes", ".", ".", { "stat": "Sum", "period": 300 } ]
                            ],
                            "view": "timeSeries",
                            "stacked": false,
                            "region": "eu-west-1",
                            "title": "Volume's bandwidth " + volume_id
                        }
                    };
                    
    return template;
}

async function describeAllInstances() {
    var json = await ec2.describeInstances().promise();
    
    var result = {};
    result.Instances = [];
    
    for (var i = 0; i < json.Reservations.length; i++) {
        for (var j = 0; j < json.Reservations[i].Instances.length; j++) {
            var instance = {};
            instance.InstanceId = json.Reservations[i].Instances[j].InstanceId;
            instance.Volumes = [];
            
            for (var k = 0; k < json.Reservations[i].Instances[j].BlockDeviceMappings.length; k++) {
                if(json.Reservations[i].Instances[j].BlockDeviceMappings[k].Ebs) {
                    var volume_id = json.Reservations[i].Instances[j].BlockDeviceMappings[k].Ebs.VolumeId;
                    instance.Volumes.push(volume_id);
                }
            }
            
            for (var l = 0; l < json.Reservations[i].Instances[j].Tags.length; l++) {
                if(json.Reservations[i].Instances[j].Tags[l].Key === "Name")
                    instance.InstanceName = json.Reservations[i].Instances[j].Tags[l].Value;
            }
            
            result.Instances.push(instance);
        }
    }
    
    return result;
}